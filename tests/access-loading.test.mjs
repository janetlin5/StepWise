import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source = ts.createSourceFile('page.tsx', fs.readFileSync('src/app/demo/page.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('let receivedAuthEvent')) effect = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(source);
function harness(getSession) {
  let status, interactions, callback, timeout;
  const noop = () => {};
  const dependencies = {
    setAccessStatus: v => { status = v; },
    window: { setTimeout: fn => { timeout = fn; return 1; }, clearTimeout: noop, sessionStorage: {} },
    transcriptAuthRef: { current: undefined },
    setServerLimitReached: noop, setServerLimitMessage: noop, setIsLoggedIn: noop,
    setCurrentUserId: noop, setProfileSyncReady: noop, setAnonymousStorageReady: noop,
    clearAnonymousTranscript: noop, loadRemoteLearningProfile: async () => {},
    getSessionIdFromUrl: () => null, loadConversation: noop,
    readAnonymousTranscript: () => null, startNewConversation: noop,
    setInteractions: v => { interactions = v; }, getAnonymousDemoUsageFromCookie: () => 5,
    supabase: { auth: { getSession, onAuthStateChange: fn => { callback = fn; return { data: { subscription: { unsubscribe: noop } } }; } } },
  };
  const js = ts.transpileModule(`const effect = ${effect.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const cleanup = new Function(...Object.keys(dependencies), `${js}; return effect();`)(...Object.values(dependencies));
  return { status: () => status, interactions: () => interactions, event: session => callback('INITIAL_SESSION', session), timeout: () => timeout(), cleanup };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('anonymous readiness uses restored cookie usage instead of a fresh allowance', async () => {
  const h = harness(async () => ({ data: { session: null }, error: null }));
  assert.equal(h.status(), 'loading');
  await settle();
  assert.equal(h.status(), 'ready');
  assert.equal(h.interactions(), 5);
  h.cleanup();
});
test('auth rejection, returned errors and timeout never unlock unknown access', async () => {
  for (const getSession of [async () => { throw Error('offline'); }, async () => ({ data: {}, error: Error('offline') })]) {
    const h = harness(getSession);
    await settle();
    assert.equal(h.status(), 'error');
    assert.equal(h.interactions(), undefined);
    h.cleanup();
  }
  const h = harness(() => new Promise(() => {}));
  h.timeout();
  assert.equal(h.status(), 'error');
  h.event(null);
  assert.equal(h.status(), 'ready');
  h.cleanup();
});
test('late getSession failure cannot override a resolved auth event', async () => {
  let reject;
  const h = harness(() => new Promise((_, r) => { reject = r; }));
  h.event(null);
  reject(Error('late failure'));
  await settle();
  assert.equal(h.status(), 'ready');
  h.cleanup();
});

test('shared action guard blocks all callers while access is unresolved', () => {
  let declaration;
  function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'canUseDemo') declaration = node;
    ts.forEachChild(node, find);
  }
  find(source);
  const js = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const guard = (ready, loggedIn, exhausted) => new Function('accessReady', 'isLoggedIn', 'localDemoLocked', 'serverLimitReached', 'serverLimitMessage', 'showServerLimitMessage', 'showDemoLimitMessage', `${js}; return canUseDemo();`)(ready, loggedIn, exhausted, false, '', () => {}, () => {});
  assert.equal(guard(false, false, false), false);
  assert.equal(guard(false, true, false), false);
  assert.equal(guard(true, false, true), false);
  assert.equal(guard(true, false, false), true);
  assert.equal(guard(true, true, true), true);
});
