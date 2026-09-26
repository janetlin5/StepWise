import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { NextResponse } from 'next/server.js';
const require = createRequire(import.meta.url);

function load(path) {
  const output = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', output)(require, mod, mod.exports);
  return mod.exports;
}
const { createTutorStream } = load('src/lib/tutorStreamServer.ts');
const { readTutorStream, TutorStreamError } = load('src/lib/tutorStreamClient.ts');
const cookies = load('src/lib/anonymousDemoLimit.ts');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const event = (name, data = {}) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
function response(text) {
  // Single-byte chunks exercise boundaries inside UTF-8 and SSE frames.
  return new Response(new ReadableStream({ start(controller) {
    for (const byte of new TextEncoder().encode(text)) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }));
}
function handlers() {
  const state = { tokens: '', answer: null, meta: null };
  return { state, onMeta: m => { state.meta = m; }, onToken: t => { state.tokens += t; }, onAnswerComplete: t => { state.answer = t; } };
}
async function* answer() {
  yield { choices: [{ delta: { content: 'Try −2.' }, finish_reason: null }] };
  yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
}

test('fragmented Unicode stream completes once and stops on done without waiting for EOF', async () => {
  const h = handlers();
  await readTutorStream(response(event('meta', { sessionId: 'test' }) + event('token', { text: '−2' }) + event('answer_complete', { text: '−2' }) + event('done')), h);
  assert.equal(h.state.tokens, '−2');
  assert.equal(h.state.answer, '−2');
});

test('EOF before answer_complete preserves partial text and rejects', async () => {
  const h = handlers();
  await assert.rejects(readTutorStream(response(event('token', { text: 'partial' })), h), e => e instanceof TutorStreamError && !e.answerComplete);
  assert.equal(h.state.tokens, 'partial');
  assert.equal(h.state.answer, null);
});

test('EOF after answer_complete reports saving uncertainty without losing the answer', async () => {
  const h = handlers();
  await assert.rejects(readTutorStream(response(event('answer_complete', { text: 'Complete.' })), h), e => e.answerComplete);
  assert.equal(h.state.answer, 'Complete.');
});

test('slow persistence keeps sending heartbeats and does not regenerate', async () => {
  let generated = 0, saved = 0, completedBeforeSave = false;
  const h = handlers();
  const stream = createTutorStream({
    generate: async () => { generated++; return answer(); },
    persist: async text => { assert.equal(text, 'Try −2.'); await delay(100); completedBeforeSave = h.state.answer === text; saved++; },
    meta: {}, onStage: () => {}, heartbeatMs: 5,
  });
  await readTutorStream(new Response(stream), h, 40);
  assert.equal(generated, 1);
  assert.equal(saved, 1);
  assert.equal(completedBeforeSave, true);
});

test('save failure retains completed answer without retrying generation', async () => {
  const h = handlers();
  const stream = createTutorStream({ generate: async () => answer(), persist: async () => { throw Error('save'); }, meta: {}, onStage: () => {} });
  await assert.rejects(readTutorStream(new Response(stream), h), e => e.answerComplete);
  assert.equal(h.state.answer, 'Try −2.');
});

test('truncated upstream output is not finalized or persisted', async () => {
  let saves = 0;
  const h = handlers();
  const stream = createTutorStream({
    generate: async () => (async function* () { yield { choices: [{ delta: { content: 'partial' }, finish_reason: 'length' }] }; })(),
    persist: async () => { saves++; }, meta: {}, onStage: () => {},
  });
  await assert.rejects(readTutorStream(new Response(stream), h), e => !e.answerComplete);
  assert.equal(h.state.tokens, 'partial');
  assert.equal(saves, 0);
});

test('idle timeout cancels the transport and never accepts partial text as complete', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(readTutorStream(new Response(stream), handlers(), 10), TutorStreamError);
  assert.equal(cancelled, true);
});

test('client cancellation aborts upstream work', async () => {
  let signal;
  const stream = createTutorStream({
    generate: async s => { signal = s; return (async function* () { await delay(10); yield { choices: [] }; })(); },
    persist: async () => assert.fail('should not save'), meta: {}, onStage: () => {},
  });
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(signal.aborted, true);
});

test('fifth anonymous response streams normally and subsequent new requests remain blocked', () => {
  const before = cookies.addAnonymousDemoUsageCookie(NextResponse.json({}), 4).headers.get('set-cookie').split(';')[0];
  assert.equal(cookies.checkAnonymousDemoUsage(new Request('https://test.local', { headers: { cookie: before } })).allowed, true);
  const streamed = cookies.addAnonymousDemoUsageCookie(new NextResponse('event: done\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), 5);
  const cookie = streamed.headers.get('set-cookie').split(';')[0];
  const result = cookies.checkAnonymousDemoUsage(new Request('https://test.local', { headers: { cookie } }));
  assert.equal(result.used, 5);
  assert.equal(result.allowed, false);
});

test('done terminates reading even when transport remains open', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(event('answer_complete', { text: 'Finished.' }) + event('done')));
    },
    cancel() { cancelled = true; },
  });
  const h = handlers();
  await readTutorStream(new Response(body), h, 10);
  assert.equal(h.state.answer, 'Finished.');
  assert.equal(cancelled, true);
});
