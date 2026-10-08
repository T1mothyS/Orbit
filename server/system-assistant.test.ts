import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { execFileSync } from 'node:child_process';
import pkg from '../package.json';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-system-query-'));
process.env.DATA_DIR=directory;process.env.ORBIT_OPERATIONS_DIR=path.join(directory,'operations');
process.env.DIGEST_V2_ENABLED='true';process.env.NODE_ENV='test';
const db=await import('./db.js'),activity=await import('./activity-store.js'),schedules=await import('./schedule-store.js'),chat=await import('./database/connection.js');
await db.initDb();await activity.initActivityDb();await schedules.initScheduleDb();
await (await import('./reminder-store.js')).initReminderDb();
const {querySystem}=await import('./system-query.js'),{createSystemRouter}=await import('./routes/system.js'),{createAuth}=await import('./auth.js');
const {searchProductHelp}=await import('./product-help.js'),{settingAction,navigationHref,settingsActions}=await import('../src/utils/navigation-actions.js');
const {isOrbitDiagnosticQuestion,isOrbitProductQuestion}=await import('./product-assistant-intent.js');
const {productAssistantContext}=await import('./product-assistant-context.js');
const {observeJob,observeJobLog}=await import('./runtime/job-status.js'),{readOperations}=await import('./operations-state.js');
const {createOrbitTools}=await import('./orbit-tools.js');
const stamp=new Date().toISOString();
for(const [id,role] of [['owner','user'],['other','user'],['admin','admin']] as const)db.createUser({id,email:id+'@example.invalid',password_hash:'synthetic',role,disabled:0,created_at:stamp,updated_at:stamp});
for(const id of ['owner','other'])schedules.createSchedule({id:id+'-schedule',user_id:id,calendar_id:'personal',type:'event',title:id+' private schedule',start_time:stamp,end_time:stamp,all_day:false,category:'life',priority:'medium',is_completed:false,is_repeated:false,reminders:[],is_high_risk:false});
const auth=createAuth({secret:'synthetic-system-test-only',getUserById:db.getUserById});
const app=express();app.use(createSystemRouter({authenticate:auth.authenticate}));
const listener=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>listener.once('listening',resolve));
const base='http://127.0.0.1:'+(listener.address() as {port:number}).port;
const headers=(id:string)=>({Authorization:'Bearer '+auth.signUserToken(db.getUserById(id)!)});
const operations=process.env.ORBIT_OPERATIONS_DIR;
fs.mkdirSync(operations,{recursive:true});
test.after(()=>{listener.closeAllConnections();listener.close();});
test('HTTP authentication, role restrictions and bounded hostile parameters',async()=>{
  assert.equal((await fetch(base+'/api/system/status')).status,401);
  for(const resource of ['errors'])assert.equal((await fetch(base+'/api/system/'+resource,{headers:headers('owner')})).status,403);
  assert.equal((await fetch(base+'/api/system/status',{headers:headers('owner')})).status,200);
  for(const suffix of ['?limit=101','?date=2026-02-30','?id=../../private','?command=reboot','?id[x]=other'])assert.equal((await fetch(base+'/api/system/tasks'+suffix,{headers:headers('owner')})).status,400);
  assert.equal((await fetch(base+'/api/system/reminder-status?id=other-schedule',{headers:headers('owner')})).status,404);
  assert.equal((await fetch(base+'/api/system/status',{method:'POST',headers:headers('admin')})).status,404);
});
test('own records remain isolated and device secrets/raw errors are absent',()=>{
  const value=querySystem('owner','reminder-status') as any;
  assert.equal(value.schedules.length,1);assert.equal(value.schedules[0].id,'owner-schedule');
  assert.equal(value.phoneDisplay,'unobserved');assert.match(value.note,/已验证/);
  assert.throws(()=>querySystem('owner','reminder-status',{id:'other-schedule'}));
  assert.deepEqual((querySystem('owner','tasks') as any).requests,[]);
});
test('cycle reminders expose rules and linked Push records without seeding on query',async()=>{
  const reminders=await import('./reminder-store.js');
  const task=reminders.createReminderTask({userId:'owner',type:'generic',name:'synthetic cycle',timezone:'UTC',config:{templateKey:'custom',rule:{frequency:'once',anchorDate:'2026-10-08',advancePolicy:'calendar'},reminderOffsets:[1,0],reminderTime:'12:00',actionGuide:'private guide',priority:'medium'}});
  const source=reminders.readReminderProjectionSources('owner').find(p=>p.task.id===task.id)!;assert(source.cycle);
  const notice=activity.enqueueNotificationDetailed({userId:'owner',sourceType:'reminder',sourceId:task.id,channel:'email',kind:'due',title:'synthetic',body:'private email',scheduledAt:stamp,dedupeKey:'synthetic-failure'}).notification;
  activity.markNotificationFailed(notice.id,'邮件服务尚未配置：SMTP_PASS');
  const before=fs.readFileSync(path.join(directory,'reminder.db'));
  const result=querySystem('owner','reminder-status',{id:task.id}) as any;
  assert.equal(result.cycles[0].taskId,task.id);assert.deepEqual(result.cycles[0].reminderOffsets,[1,0]);assert.equal(result.notifications[0].errorCode,'EMAIL_CONFIG');
  assert.doesNotMatch(JSON.stringify(result),/private|SMTP_PASS/);assert.deepEqual(fs.readFileSync(path.join(directory,'reminder.db')),before);
  assert.throws(()=>querySystem('other','reminder-status',{id:task.id}));
});
test('success hides prior failures of the same service; admin diagnostics survive seven days',()=>{
  const records=[{id:'failed-main',service:'main',status:'failed',finishedAt:new Date(Date.now()-5000).toISOString(),errorCode:'HEALTH_CHECK_FAILED',failureStage:'HEALTH',path:'/private/secret',raw:'sensitive'}, {id:'success-main',service:'main',status:'success',finishedAt:stamp,version:pkg.version,commit:'a'.repeat(40)}, {id:'failed-shadow',service:'shadow',status:'failed',finishedAt:stamp,errorCode:'STATIC_ASSET_FAILED',failureStage:'ASSETS'}];
  fs.writeFileSync(path.join(operations,'deployments.json'),JSON.stringify({records}));
  const visible=querySystem('owner','deployments') as any;
  assert.deepEqual(visible.records.map((r:any)=>r.id).sort(),['failed-shadow','success-main']);
  assert.doesNotMatch(JSON.stringify(visible),/secret|sensitive|errorCode|failureStage/);
  const errors=querySystem('admin','errors') as any;assert(errors.errors.some((e:any)=>e.code==='HEALTH_CHECK_FAILED'));
  records[0].finishedAt=new Date(Date.now()-8*86400000).toISOString();fs.writeFileSync(path.join(operations,'deployments.json'),JSON.stringify({records}));
  assert(!(querySystem('admin','errors') as any).errors.some((e:any)=>e.code==='HEALTH_CHECK_FAILED'));
});
test('host snapshots and jobs return only whitelisted observations, with freshness',()=>{
  fs.writeFileSync(path.join(operations,'status.json'),JSON.stringify({observedAt:stamp,services:[{service:'shadow',state:'active',health:'responding',env:'secret'}],retention:{managedLogBytes:30,capacityWarning:false,path:'secret',warnings:[{code:'RECOVERY_UNVERIFIED',path:'secret'}]}}));
  assert.doesNotMatch(JSON.stringify(querySystem('admin','status')),/secret|path|env/);
  assert.doesNotMatch(JSON.stringify(querySystem('owner','status')),/retention/);
  fs.writeFileSync(path.join(operations,'status.json'),JSON.stringify({observedAt:'2000-01-01',services:[]}));
  assert.equal((querySystem('admin','status') as any).hostObservation.status,'stale');
});
test('job failures caught internally cannot become success; skip/success timestamps persist',async()=>{
  await observeJob('synthetic',async()=>{observeJobLog('error',{event:'INPUTS_FAILED'});});
  let job=readOperations<any>('jobs.json',{}).synthetic;assert.equal(job.status,'failed');assert.equal(job.reason,'INPUTS_FAILED');assert(job.lastFailureAt);
  await observeJob('synthetic',()=>({status:'skipped',reason:'DATABASE_NOT_READY'}));
  job=readOperations<any>('jobs.json',{}).synthetic;assert.equal(job.status,'skipped');assert(job.lastSkippedAt);
  await observeJob('synthetic',()=>{});job=readOperations<any>('jobs.json',{}).synthetic;assert.equal(job.status,'success');assert(job.lastSuccessAt);assert(job.lastFailureAt);
  await assert.rejects(observeJob('synthetic',()=>{throw Object.assign(new Error('private key text'),{code:'PROVIDER_FAILED'});}));
  assert.doesNotMatch(JSON.stringify(readOperations('jobs.json',{})),/private key/);
});
test('daily-report stages use manifests without exposing input mail or another account',()=>{
  const date='2026-10-08';
  for(const userId of ['owner','other'])activity.createDigestRun({id:userId+'-run',user_id:userId,report_date:date,snapshot_json:'{"mail":"private email"}',manifest_json:JSON.stringify({status:'FAILED',failedPhase:'MEDIA_PREPARING',code:'STORY_IMAGE_NOT_READY',events:[{status:'INPUTS_FAILED',inputSections:[{section:'mail',status:'failed'}],at:stamp},{status:'VALIDATION_FAILED',errors:[{code:'CONTENT_INCOMPLETE',message:'private'}],at:stamp},{status:'REPORT_SAVED',at:stamp},{status:'FAILED',code:'STORY_IMAGE_NOT_READY',at:stamp}]}),created_at:stamp,expires_at:stamp});
  const value=querySystem('owner','daily-report-status',{date}) as any;assert.equal(value.runs.length,1);assert.equal(value.runs[0].id,'owner-run');assert.equal(value.runs[0].events[0].inputSections[0].status,'failed');
  assert.doesNotMatch(JSON.stringify(value),/private|other-run/);assert.equal(value.externalScheduler,'unobserved');assert.equal(value.modelExecution,'unobserved');
  assert.equal((querySystem('owner','daily-report-status',{date:'2026-10-09'}) as any).status,'no_record');
  assert.equal((querySystem('owner','daily-report-status',{date,source:'local'}) as any).runs.length,0);
  activity.updateDigestRunManifest('owner','owner-run',{status:'SHADOW_SAVED',mode:'shadow'});
  assert.equal((querySystem('owner','daily-report-status',{date,source:'cloud'}) as any).runs.length,0);
  assert.equal((querySystem('owner','daily-report-status',{date,source:'shadow'}) as any).runs[0].mode,'shadow');
  const relative = productAssistantContext('owner','昨天日报为什么没有生成') as any[];
  const today=(querySystem('owner','daily-report-status') as any).date;
  assert.equal(relative.find(r=>r.runs).date,new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10));
});
test('product help is separate, version bound, and filters admin-only deployment docs',()=>{
  const chunk={id:'one',source:'docs/USER-GUIDE.md',title:'日报行业设置',content:'在日报设置修改关注行业。',contentHash:'x',sourceHash:'y',admin:false};
  const index={formatVersion:1,version:pkg.version,chunks:[chunk,{...chunk,id:'two',source:'docs/RELEASE.md',admin:true}]};
  assert.equal(searchProductHelp('日报行业',false,index).matches.length,1);
  assert.equal(searchProductHelp('日报行业',true,index).matches.length,2);
  assert.equal(searchProductHelp('日报行业',true,{...index,version:'old'}).status,'unobserved');
  assert.throws(()=>searchProductHelp('a'.repeat(301)));
});
test('semantic actions map existing settings, reject mismatches/unknown/admin/test targets',()=>{
  const action=settingsActions('怎么修改日报关注行业')[0];assert(action);assert.equal(action.type,'navigate');assert.match(navigationHref(action)!,/^\/reports\/settings\?settings=/);
  assert.equal(navigationHref({...action,target:'settings.profile'}),null);
  assert.equal(settingAction('https://malicious.invalid'),null);assert.equal(settingAction('android-local-test'),null);
  assert.equal(navigationHref({type:'navigate',target:'settings.general',settingId:'unknown',url:'https://malicious.invalid'}),null);
  assert.equal(navigationHref(settingAction('library-personal-preferences')),'/settings/profile?settings=library-personal-preferences');
  assert.equal(navigationHref(settingAction('settings-library')),'/library/settings?settings=settings-library');
  assert.deepEqual(JSON.parse(JSON.stringify(action)),action); // The persisted action stays semantic.
});
test('diagnostics outrank published-report shortcut; ordinary schedule creation remains distinct',()=>{
  for(const q of ['今天日报为什么没生成？','我的提醒为什么没有执行？','当前 Orbit 部署的是哪个版本？'])assert(isOrbitDiagnosticQuestion(q));
  assert(isOrbitProductQuestion('知识库怎么设置？'));assert(isOrbitProductQuestion('怎么修改日报关注行业？'));
  assert(!isOrbitProductQuestion('明天提醒我开会'));assert(!isOrbitProductQuestion('怎么创建明天开会的提醒'));
  const evidence=productAssistantContext('owner','今天日报为什么没生成？') as any[];assert(evidence.some(e=>e.domain==='runtime' && e.externalScheduler==='unobserved'));
});
test('tools expose read queries and actions, without notification tests, shell or mutation',async()=>{
  const context=createOrbitTools({userId:'owner',timezone:'Asia/Shanghai',allowKnowledge:false,allowHistory:false});
  assert(!context.tools.some(t=>/shell|restart|send|delete|notification.test|recent_errors|knowledge/.test(t.name)));
  const settings=context.tools.find(t=>t.name==='settings')!;await settings.execute({query:'日报关注行业'});
  assert(context.actions.length);assert.doesNotMatch(JSON.stringify(context.actions),/url|href/);
  await assert.rejects(settings.execute({query:'x',command:'reboot'}));
});
test('operations retention regression tests use synthetic directories only',()=>{
  execFileSync(process.platform==='win32'?'python':'python3',['scripts/orbit_operations_test.py'],{cwd:path.resolve('.'),timeout:60000,stdio:'pipe'});
});
