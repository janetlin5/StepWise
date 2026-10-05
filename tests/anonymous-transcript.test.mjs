import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const js = ts.transpileModule(fs.readFileSync('src/lib/anonymousTranscript.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
new Function('exports', js)(api);
function store() {
  const items = new Map();
  return { getItem: k => items.get(k) ?? null, setItem: (k,v) => items.set(k,v), removeItem: k => items.delete(k) };
}
const transcript = { version: 1, sessionId: '12345678-abcd-abcd-abcd-123456789abc', messages: [{ id: 1, role: 'user', content: 'x² + 9y² = 18' }], currentProblem: 'Find the center', problem: 'Ellipse worksheet', draft: 'Is (0, 0) right?' };
test('refresh restores transcript, session, problem and draft within one tab', () => {
  const storage = store();
  api.writeAnonymousTranscript(storage, transcript);
  assert.deepEqual(api.readAnonymousTranscript(storage), transcript);
  assert.equal(api.readAnonymousTranscript(store()), null);
});
test('new session or login can remove the anonymous copy', () => {
  const storage = store(); api.writeAnonymousTranscript(storage, transcript);
  api.clearAnonymousTranscript(storage);
  assert.equal(api.readAnonymousTranscript(storage), null);
});
test('corrupt and invalid storage is ignored', () => {
  const storage = store();
  for (const raw of ['{bad', 'null', JSON.stringify({...transcript, sessionId: 'bad'}), JSON.stringify({...transcript, messages:[{id:1,role:'system',content:'bad'}]})]) {
    storage.setItem(api.anonymousTranscriptKey, raw);
    assert.equal(api.readAnonymousTranscript(storage), null);
  }
});
test('blocked storage does not break chat', () => {
  const fail = () => { throw Error('denied'); };
  const storage = { getItem: fail, setItem: fail, removeItem: fail };
  assert.equal(api.readAnonymousTranscript(storage), null);
  assert.doesNotThrow(() => api.writeAnonymousTranscript(storage, transcript));
  assert.doesNotThrow(() => api.clearAnonymousTranscript(storage));
});
