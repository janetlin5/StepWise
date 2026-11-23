import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
function compile(file, deps = {}) {
 const exp = {}; const js = ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('exports','require',js)(exp,id=>deps[id]); return exp;
}
const helper = compile('src/lib/responseFeedback.ts');
test('selected earlier response is frozen with only its preceding message and original problem',()=>{
 const messages=[{id:1,role:'user',content:'My attempt'}, {id:2,role:'assistant',content:'Earlier reply',problem:'3x+5=17'}, {id:3,role:'user',content:'Unrelated'}];
 const snapshot=helper.buildResponseReport(messages,2,'session');
 messages[1].content='changed';messages.push({id:4,role:'assistant',content:'New reply'});
 assert.equal(snapshot.response,'Earlier reply');assert.equal(snapshot.studentMessage,'My attempt');assert.equal(snapshot.problem,'3x+5=17');
 assert.equal(helper.buildResponseReport(messages,1,'session'),null);
});
test('reports discard unknown fields and bound strings and embedded attachment data',()=>{
 const r=helper.sanitizeResponseReport({kind:'tutor_response',response:'x'.repeat(20000),problem:'data:image/png;base64,SECRET',token:'secret',history:['private'],sessionId:'a'.repeat(1000)});
 assert.equal(r.response.length,5000);assert.equal(r.sessionId.length,100);assert.equal(r.problem,'[attachment omitted]');assert.equal(r.token,undefined);assert.equal(r.history,undefined);
 assert.equal(helper.sanitizeResponseReport({kind:'tutor_response',response:''}),null);
});
const source=ts.createSourceFile('feedback.tsx',fs.readFileSync('src/components/HelpFeedbackButton.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let submit;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='handleSubmit')submit=n;ts.forEachChild(n,visit);}visit(source);
function submission(fetcher){
 const states=[];const sending={current:false};const values={category:'Tutor response issue',sending,status:'idle',message:'My note',selectedReport:{kind:'tutor_response',response:'Selected'},context:{history:['unrelated']},supabase:{auth:{getSession:async()=>({data:{session:null}})}},fetch:fetcher,window:{location:{origin:'https://example.com',pathname:'/demo'},navigator:{userAgent:'test',language:'en'},innerWidth:390,innerHeight:800},setErrorMessage:v=>states.push(['error',v]),setStatus:v=>states.push(['status',v]),setMessage:v=>states.push(['message',v])};
 const js=ts.transpileModule(submit.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 return {run:new Function(...Object.keys(values),js+';return handleSubmit;')(...Object.values(values)),states,sending};
}
test('in-flight submissions are locked and payload excludes unrelated context',async()=>{
 let finish;let calls=0;const h=submission(async(_,init)=>{calls++;const p=JSON.parse(init.body);assert.equal(p.context.response,'Selected');assert.equal(p.context.history,undefined);return new Promise(r=>finish=r);});
 const first=h.run();await new Promise(r=>setImmediate(r));await h.run();assert.equal(calls,1);finish({ok:true});await first;assert.equal(h.sending.current,false);
});
test('network failure releases lock and keeps the draft for retry',async()=>{
 let calls=0;const h=submission(async()=>{calls++;throw Error('offline');});await h.run();assert.equal(h.sending.current,false);assert.equal(h.states.some(([key])=>key==='message'),false);await h.run();assert.equal(calls,2);
});

test('server attributes reports to the authenticated user without reading the claimed session',async()=>{
 const { createRequire } = await import('node:module');const require=createRequire(import.meta.url);
 const security=compile('src/lib/apiSecurity.ts');let inserted;
 const route=compile('src/app/api/feedback/route.ts',{
  '@/lib/responseFeedback':helper,'@/lib/apiSecurity':security,'next/server':require('next/server'),
  '@/lib/usageLimits':{getBearerToken:()=>null,getAuthenticatedUser:async()=>({id:'actual-user'})},
  '@supabase/supabase-js':{createClient:()=>({from:()=>({insert:async value=>{inserted=value;return {error:null};}})})}
 });
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.com';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test';
 const res=await route.POST(new Request('https://example.com/api/feedback',{method:'POST',body:JSON.stringify({user_id:'victim',message:'Wrong answer',context:{kind:'tutor_response',sessionId:'another-users-session',response:'Client supplied',user_id:'victim',history:['private']}})}));
 assert.equal(res.status,200);assert.equal(inserted.user_id,'actual-user');assert.equal(inserted.context.user_id,undefined);assert.equal(inserted.context.history,undefined);
});
