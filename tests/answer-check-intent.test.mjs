import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const compiled = ts.transpileModule(fs.readFileSync('src/lib/answerCheckIntent.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
new Function('exports', compiled)(mod.exports);
const { hasAnswerCheckIntent, hasProposedNumericAnswer } = mod.exports;

test('short numeric verification questions include both intent and a submitted answer', () => {
  for (const text of ['Is the vertex (0, -2)?', 'Is the slope -6?', 'Is the radius of the circle 5?', 'Is the focus (2, −0.5)?', 'Is the directrix y = -2?', 'Is the probability .5?', String.raw`Is the vertex \(0, -2\)?`]) {
    assert.equal(hasAnswerCheckIntent(text), true, text);
    assert.equal(hasProposedNumericAnswer(text), true, text);
  }
});

test('problem references and questions without an answer do not become numeric answer checks', () => {
  for (const text of ['Is the problem 7 on this worksheet?', 'Is the question (3) about slopes?', 'Is the vertex above the focus?', 'What is the slope?', 'Is the slope -?', 'Is the vertex (x, y)?']) {
    assert.equal(hasProposedNumericAnswer(text), false, text);
    assert.equal(hasAnswerCheckIntent(text), false, text);
  }
});

test('existing answer-check phrases remain supported', () => {
  for (const text of ['Check my answer', 'I got x = 3', 'Is this right?', 'Can you verify my work?', 'My answer is 2']) {
    assert.equal(hasAnswerCheckIntent(text), true, text);
  }
});

test('client and tutor API accept short proposed answers through their attempt gates', () => {
  for (const [file, name] of [
    ['src/app/demo/page.tsx', 'hasFullAttemptSignal'],
    ['src/app/api/demo-help/route.ts', 'hasSubmittedAnswerSignal'],
  ]) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration);
    const js = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    const gate = new Function('hasProposedNumericAnswer', `${js}\nreturn ${name};`)(hasProposedNumericAnswer);
    assert.equal(gate('Is the vertex (0, -2)?'), true, file);
    assert.equal(gate('Is the slope -6?'), true, file);
    assert.equal(gate('Check my answer'), false, file);
  }
});
