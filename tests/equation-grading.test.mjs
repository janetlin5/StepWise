import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const js = ts.transpileModule(fs.readFileSync('src/lib/equationGrading.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const mod = {};
new Function('exports', js)(mod);
const { equationsEquivalent: eq, submittedEquation, evaluateEquationAnswer } = mod;

test('accepts exact decimal/fraction equivalence for the reported ellipse', () => {
  for (const attempt of ['(1/18)x² + .5y^2 = 1', 'y^2/2+x^2/18=1', 'x^2+9y^2-18=0', '18=x^2+9y^2', '-x^2-9y^2=-18', String.raw`\frac{x^{2}}{18}+\frac{y^{2}}{2}=1`]) {
    assert.equal(eq('x^2+9y^2=18', attempt), true, attempt);
  }
});

test('preserves signs and rejects wrong ellipse coefficients', () => {
  assert.equal(eq('x^2/18+y^2/2=1', 'x^2/18+.05y^2=1'), false);
  assert.equal(eq('(x-2)^2/9+(y+1)^2/4=1', '(x-2)^2/9+(y-1)^2/4=1'), false);
  assert.equal(eq('(x-2)^2/9+(y+1)^2/4=1', '4*x^2+9*y^2-16*x+18*y-11=0'), true);
});

test('does not use approximate numeric equality', () => {
  assert.equal(eq('x^2/3+y^2=1', '.3333333333333333x^2+y^2=1'), false);
  assert.equal(eq('x^2/3+y^2=1', '2/6*x^2+y^2=1'), true);
});

test('unsupported and ambiguous expressions are not guessed', () => {
  for (const input of ['x/x=1', 'x^3+y=1', 'sqrt(x)+y=1', 'x=1=2', 'x+1/0=2', 'x^2+y^2=1; x=2', 'x^2+1 2y^2=1']) {
    assert.equal(submittedEquation(input), null, input);
  }
  assert.equal(eq('x^2=0', 'x=0'), null);
  assert.equal(eq('x^2+y^2=-1', 'x^2+y^2=-2'), null);
});

test('recognizes common answer-check wrappers', () => {
  assert.ok(submittedEquation('Is this (1/18)x^2 + .5y^2 = 1 correct?'));
  assert.ok(submittedEquation('I got x^2/18 + y^2/2 = 1'));
});

test('isolated solver cannot override server comparison with an incorrect verdict', async () => {
  const requests = [];
  const openai = { chat: { completions: { create: async payload => {
    requests.push(payload);
    return { choices: [{ message: { content: JSON.stringify({ answerType: 'equation', expected: 'x^2/18+y^2/2=1', verdict: 'incorrect' }) } }] };
  } } } };
  const problem = 'Analyze the ellipse x^2+9y^2=18.';
  assert.equal((await evaluateEquationAnswer({ openai, problem, studentMessage: '(1/18)x^2+.5y^2=1' })).verdict, 'correct');
  assert.equal((await evaluateEquationAnswer({ openai, problem, studentMessage: '(1/18)x^2+.05y^2=1' })).verdict, 'incorrect');
  assert.deepEqual(requests[0], requests[1]);
  assert.ok(!JSON.stringify(requests).includes('.5y'));
});
