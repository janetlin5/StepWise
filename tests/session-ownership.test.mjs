import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function load(path, dependencies = {}) {
  const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', 'require', js)(exports, id => dependencies[id]);
  return exports;
}
const security = load('src/lib/apiSecurity.ts');
const api = load('src/lib/sessionOwnership.ts', { '@/lib/apiSecurity': security });
const id = '11111111-1111-4111-8111-111111111111';
function database(initial = {}, options = {}) {
  const rows = structuredClone(initial);
  const writes = [];
  return {
    rows, writes,
    from(table) {
      let update;
      const filters = {};
      const query = {
        select() { return query; },
        eq(key, value) { filters[key] = value; return query; },
        update(value) { update = value; return query; },
        async maybeSingle() {
          if (options.lookupError && !update) return { data: null, error: { message: 'unavailable' } };
          const row = rows[table];
          const matches = row && Object.entries(filters).every(([key, value]) => row[key] === value);
          if (update && matches) { Object.assign(row, update); writes.push({ table, update }); }
          return { data: matches ? row : null, error: null };
        },
        async upsert(value, config) {
          assert.equal(config.ignoreDuplicates, true);
          options.beforeInsert?.(rows, table);
          if (!rows[table]) rows[table] = { ...value };
          writes.push({ table, insert: value });
          return { error: options.insertError ? { message: 'unavailable' } : null };
        },
      };
      return query;
    },
  };
}
const row = user_id => ({ id, user_id, topic: 'original' });
test('existing owners and new IDs produce one consistent authorized ID', async () => {
  const db = database({ learning_sessions: row('a'), sessions: row('a') });
  assert.equal(await api.authorizeSession(db, id, 'a'), id);
  assert.equal(db.writes.length, 0);
  const fresh = database();
  const newId = await api.authorizeSession(fresh, undefined, 'a');
  assert.equal(fresh.rows.learning_sessions.id, newId);
  assert.equal(fresh.rows.sessions.id, newId);
});
test('foreign owners in either table block all writes, including conflicting owners', async () => {
  for (const initial of [{ learning_sessions: row('b') }, { sessions: row('b') }, { learning_sessions: row('a'), sessions: row('b') }]) {
    const db = database(initial);
    await assert.rejects(api.authorizeSession(db, id, 'a'), { status: 403 });
    assert.deepEqual(db.rows, initial);
    assert.equal(db.writes.length, 0);
  }
});
test('returned lookup errors fail closed and malformed IDs never reach storage', async () => {
  const db = database({}, { lookupError: true });
  await assert.rejects(api.authorizeSession(db, id, 'a'), { status: 503 });
  assert.equal(db.writes.length, 0);
  await assert.rejects(api.authorizeSession(db, 'invalid', 'a'), { status: 400 });
});
test('a competing claim between lookup and insert never overwrites the winner', async () => {
  const db = database({}, { beforeInsert: (rows, table) => { rows[table] = row('b'); } });
  await assert.rejects(api.authorizeSession(db, id, 'a'), { status: 403 });
  assert.equal(db.rows.learning_sessions.user_id, 'b');
  assert.equal(db.rows.sessions.user_id, 'b');
  assert.equal(db.rows.learning_sessions.topic, 'original');
});
test('owned updates cannot transfer ownership and recheck owner at write time', async () => {
  const db = database({ learning_sessions: row('a') });
  await api.updateOwnedSession(db, 'learning_sessions', id, 'a', { topic: 'new', user_id: 'b', id: 'different' });
  assert.deepEqual(db.rows.learning_sessions, { ...row('a'), topic: 'new' });
  db.rows.learning_sessions.user_id = 'b';
  await assert.rejects(api.updateOwnedSession(db, 'learning_sessions', id, 'a', { topic: 'stolen' }), { status: 403 });
  assert.equal(db.rows.learning_sessions.topic, 'new');
});
test('failed reservation does not authorize a session', async () => {
  await assert.rejects(api.authorizeSession(database({}, { insertError: true }), id, 'a'), { status: 503 });
});

function extractFunction(file, name, dependencies) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration);
  const js = ts.transpileModule(declaration.getText(source).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), `${js}\nreturn ${name};`)(...Object.values(dependencies));
}

test('worksheet persistence cannot overwrite another account', async () => {
  const db = database({ learning_sessions: row('b') });
  const persist = extractFunction('src/app/api/analyze-homework/route.ts', 'persistWorksheetContext', {
    createSupabaseServerClient: () => db,
    getStoredWorksheetContext: () => null,
    mergeWorksheetContexts: (_, incoming) => incoming,
    updateOwnedSession: api.updateOwnedSession,
  });
  await assert.rejects(persist({ userId: 'a', sessionId: id, fileName: 'image.jpg', fileType: 'image/jpeg', analysis: { currentProblem: 'x=2', problems: [], visualSummary: '' } }), { status: 403 });
  assert.equal(db.rows.learning_sessions.topic, 'original');
  assert.equal(db.rows.learning_sessions.user_id, 'b');
});

test('tutor session setup only updates reserved rows belonging to its caller', async () => {
  const db = database({ learning_sessions: row('a'), sessions: row('a') });
  const ensure = extractFunction('src/lib/learningMemory.ts', 'ensureLearningSession', {
    createSupabaseServerClient: () => db,
    identifyCurrentTopic: () => ({ topic: 'algebra', subtopic: 'equations' }),
    updateOwnedSession: api.updateOwnedSession,
  });
  const result = await ensure({ userId: 'a', sessionId: id, profile: {}, problem: 'x=2', studentMessage: 'help' });
  assert.equal(result.sessionId, id);
  assert.equal(db.rows.learning_sessions.topic, 'algebra');
  assert.equal(db.rows.sessions.topic, 'algebra');
  db.rows.sessions.user_id = 'b';
  await assert.rejects(ensure({ userId: 'a', sessionId: id, profile: {}, problem: 'x=3', studentMessage: 'help' }), { status: 403 });
  assert.equal(db.rows.sessions.problem_text, 'x=2');
});
