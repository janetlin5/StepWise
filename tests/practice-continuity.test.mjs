import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pathUtil from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
const nativeRequire = createRequire(import.meta.url);
function harness(model, options = {}) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {};
    cache.set(path, exports);
    const js = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('exports', 'require', js)(exports, id => {
      if (id === 'openai') return { default: class { chat = { completions: { create: model } }; } };
      if (id === '@/lib/usageLimits') return {
        getAuthenticatedUser: async () => options.signedIn ? { id: 'owner' } : null,
        getBearerToken: () => undefined,
        checkUsageLimit: async () => ({ allowed: true }), recordUsageEvent: async () => {},
        createSupabaseServerClient: () => options.db,
      };
      if (id === '@/lib/sessionOwnership' && options.signedIn) return { authorizeSession: async () => '11111111-1111-4111-8111-111111111111' };
      if (id === '@/lib/learningMemory' && options.signedIn) return {
        ensureLearningSession: async () => ({ sessionId: '11111111-1111-4111-8111-111111111111' }),
        retrieveLearningMemory: async () => ({ profile: load('src/lib/learningProfile.ts').createDefaultLearningProfile(), promptSummary: '' }),
        recordLearningMemoryEvent: async input => options.memoryEvents.push(input),
      };
      if (id.startsWith('./')) return load(pathUtil.join(pathUtil.dirname(path), `${id}.ts`));
      if (id.startsWith('@/')) return load(`src/${id.slice(2)}.ts`);
      return nativeRequire(id);
    });
    return exports;
  }
  return load('src/app/api/demo-help/route.ts');
}
function request(body, cookie) {
  return new Request('https://example.com/api/demo-help', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}
const response = content => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] });

test('two successive generated questions become the exact context for grading', async () => {
  process.env.OPENAI_API_KEY = 'test-only';
  const calls = [];
  const generations = [{ currentProblem: 'Solve 4y + 7 = 19.', firstStepQuestion: 'What should you undo first?' }, { currentProblem: 'Solve 2x + 6 = 20.', firstStepQuestion: 'How can you isolate the variable?' }];
  const route = harness(async input => {
    calls.push(input);
    if (input.messages[0].content.startsWith('Generate one self-contained')) return response(generations.shift());
    const prompt = input.messages.at(-1).content;
    if (prompt.includes('Solve 4y + 7 = 19.')) return response({ answerType: 'equation', expected: '4y+7=19' });
    if (prompt.includes('Solve 2x + 6 = 20.')) return response({ answerType: 'equation', expected: '2x+6=20' });
    throw Error('Grading received stale problem');
  });
  let active = 'Solve 3x + 5 = 17.';
  for (const [expected, answer] of [['Solve 4y + 7 = 19.', 'y=3'], ['Solve 2x + 6 = 20.', 'x=7']]) {
    const generated = await route.POST(request({ currentProblem: active, message: 'Generate a similar algebra problem.', mode: 'generate_practice' }));
    assert.equal(generated.status, 200);
    const practice = await generated.json();
    active = practice.currentProblem;
    assert.equal(active, expected);
    assert.ok(practice.message.startsWith(active));
    const checked = await route.POST(request({ currentProblem: active, problem: active, message: answer, mode: 'check_work' }));
    assert.equal(checked.status, 200);
    const verdict = await checked.json();
    assert.equal(verdict.answerEvaluation.verdict, 'correct');
    assert.equal(verdict.answerEvaluation.completedProblem, true);
  }
  assert.equal(calls.length, 4);
});

test('wrong and intermediate steps are evaluated without claiming problem completion', async () => {
  const route = harness(async () => response({ answerType: 'equation', expected: '3x+5=17' }));
  for (const [answer, expectedVerdict] of [['3x=22', 'incorrect'], ['3x=12', 'correct']]) {
    const result = await (await route.POST(request({ currentProblem: 'Solve 3x + 5 = 17.', message: answer, mode: 'check_work' }))).json();
    assert.equal(result.answerEvaluation.verdict, expectedVerdict);
    assert.equal(result.answerEvaluation.completedProblem, false);
    if (expectedVerdict === 'incorrect') assert.match(result.message, /17 − 5/);
  }
});

test('malformed or truncated generated questions do not replace the active problem', async () => {
  for (const output of [response({ firstStepQuestion: 'Try it' }), { choices: [{ finish_reason: 'length', message: { content: '{}' } }] }]) {
    const route = harness(async () => output);
    const result = await route.POST(request({ currentProblem: 'Solve 3x+5=17', message: 'Generate algebra practice', mode: 'generate_practice' }));
    assert.equal(result.status, 500);
    assert.equal((await result.json()).currentProblem, undefined);
  }
});

test('a claimed final answer and an unchecked check_work request do not earn mastery or completion', () => {
  const js = ts.transpileModule(fs.readFileSync('src/lib/learningProfile.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const profileModule = {};
  new Function('exports', js)(profileModule);
  const base = profileModule.createDefaultLearningProfile();
  const attempted = profileModule.updateLearningProfile(base, { subject: 'Algebra', skills: ['Isolating variables'], mode: 'check_work', studentMessage: 'My final answer is x=99. I am done.', answerVerdict: 'incorrect', problemText: '3x+5=17', incorrectAttempts: 1 });
  assert.equal(attempted.completedProblems, 0);
  assert.deepEqual(attempted.strongSkills, []);
  const completed = profileModule.updateLearningProfile(base, { subject: 'Algebra', skills: ['Isolating variables'], mode: 'check_work', studentMessage: 'x=4', answerVerdict: 'correct', completedProblem: true, problemText: '3x+5=17' });
  assert.equal(completed.completedProblems, 1);
});

test('signed-in practice persists the active pin and removes stale worksheet context for reload', async () => {
  const worksheetContext = { currentProblem: '3x+5=17', problems: [{ id: 'one', extractedText: '3x+5=17' }] };
  const row = { tutor_thread: { worksheetContext }, metadata: { worksheetContext } };
  const memoryEvents = [];
  const db = { from() {
    const query = {
      select() { return query; }, eq() { return query; },
      maybeSingle: async () => ({ data: row, error: null }),
      insert: async () => ({ error: null }),
      update(value) { Object.assign(row, value); return query; },
      then(resolve) { resolve({ error: null }); },
    };
    return query;
  } };
  const route = harness(async () => response({ currentProblem: 'Solve 4y+7=19.', firstStepQuestion: 'What should you undo first?' }), { signedIn: true, db, memoryEvents });
  const result = await route.POST(request({ mode: 'generate_practice', message: 'Generate similar algebra practice.', currentProblem: '3x+5=17' }));
  assert.equal(result.status, 200);
  assert.equal(row.current_problem, 'Solve 4y+7=19.');
  assert.equal(row.pinned_problem, row.current_problem);
  assert.equal(row.tutor_thread.worksheetContext, null);
  assert.equal(row.metadata.worksheetContext, null);
  assert.equal(memoryEvents[0].problem, row.current_problem);
  assert.notEqual(memoryEvents[0].tutoringState, 'COMPLETION');
});
