import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = fs.readFileSync('src/lib/coordinateGrading.ts', 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = { exports: {} };
new Function('exports', js)(mod.exports);
const { parseSubmittedPoint, comparePointAnswer, evaluateCoordinateAnswer, coordinateTarget } = mod.exports;

test('strict grading distinguishes correct, sign slip, both wrong, and swapped coordinates', () => {
  for (const [point, verdict] of [
    ['(2, −1)', 'correct'], ['(2, 1)', 'partially_correct'], ['(5, 5)', 'incorrect'], ['(-1, 2)', 'incorrect'],
    ['(2.0, -2/2)', 'correct'], ['(4/2, -1.00)', 'correct'],
  ]) {
    assert.equal(comparePointAnswer(['2', '-1'], parseSubmittedPoint(point)).verdict, verdict, point);
  }
  assert.match(comparePointAnswer(['2', '-1'], ['2', '1']).explanation, /sign of the y-coordinate/);
});

test('exact rational comparison does not use floating point tolerances', () => {
  assert.equal(comparePointAnswer(['1/3', '0'], ['0.3333333333333333', '-0']).verdict, 'partially_correct');
  assert.equal(comparePointAnswer(['1/3', '0'], ['2/6', '-0']).verdict, 'correct');
});

test('ambiguous, malformed, symbolic and multi-answer submissions are not guessed', () => {
  for (const text of ['(2, 1) or (2, -1)', '(2, 1, 0)', '(2, 1/0)', '(x, y)', '(2, sqrt(1))', 'No answer yet', '(2, 1)^2', '(1 1/2, 3)', 'Given (2, 1), is the vertex elsewhere?']) {
    assert.equal(parseSubmittedPoint(text), null, text);
  }
  assert.deepEqual(parseSubmittedPoint(String.raw`Is the vertex \left(\frac{4}{2}, -\frac{2}{2}\right)?`), ['4/2', '-2/2']);
  assert.equal(comparePointAnswer(['2', 'oops'], ['2', '1']).verdict, 'ambiguous');
});

test('isolated solver never receives student answer or a correctness verdict request', async () => {
  const calls = [];
  const openai = { chat: { completions: { create: async payload => {
    calls.push(payload);
    // Even a contradictory model verdict must have no authority over comparison.
    return { choices: [{ message: { content: JSON.stringify({ answerType: 'point', expected: ['2', '-1'], verdict: 'correct' }) } }] };
  } } } };
  const problem = 'Find the vertex of y = (x - 2)^2 - 1.';
  const wrong = await evaluateCoordinateAnswer({ openai, problem, studentMessage: 'Is the vertex (2, 1)?' });
  const right = await evaluateCoordinateAnswer({ openai, problem, studentMessage: 'Is the vertex (2, -1)?' });
  assert.equal(wrong.verdict, 'partially_correct');
  assert.equal(right.verdict, 'correct');
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].messages.length, 2);
  assert.ok(!JSON.stringify(calls).includes('(2, 1)'));
  assert.equal(coordinateTarget('Is the vertex for problem 7 (2, 1)?'), 'Find the vertex. Use problem #7.');
});

test('solver failures and unsupported outputs cannot produce a correct verdict', async () => {
  for (const content of ['', '{}', '{bad', JSON.stringify({ answerType: 'other', verdict: 'correct' }), JSON.stringify({ answerType: 'point', expected: ['2', 'NaN'] })]) {
    const openai = { chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } } };
    assert.equal((await evaluateCoordinateAnswer({ openai, problem: 'Find the vertex.', studentMessage: '(2, 1)' })).verdict, 'ambiguous');
  }
});

test('multiple proposed points ask for clarification without spending a solver call', async () => {
  const result = await evaluateCoordinateAnswer({ openai: {}, problem: 'Find vertex.', studentMessage: 'Is the vertex (2, 1) or (2, -1)?' });
  assert.equal(result.verdict, 'ambiguous');
});
