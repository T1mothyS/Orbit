import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type { Schedule } from './schedule-store.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-v2-test-'));
Object.assign(process.env,{DATA_DIR:root,NODE_ENV:'test',APP_ENV:'development',BACKGROUND_JOBS_ENABLED:'false',ORBIT_PROACTIVE_ENABLED:'false',BACKUP_ENCRYPTION_KEY:'synthetic-only'});
const api=await import('./index.js');await api.initializeServer();
const db=await import('./db.js'),store=await import('./orbit-store.js'),queue=await import('./orbit-queue.js'),schedules=await import('./schedule-store.js'),reminders=await import('./reminder-store.js'),sync=await import('./reminder-calendar-sync.js');
const {run,queryAll}=await import('./database/connection.js');
const time=await import('./orbit-time.js'),stats=await import('./orbit-statistics.js'),proactive=await import('./orbit-proactive.js');
const {schedulesForQuery}=await import('./orbit-schedule-context.js');
const {isReadOnlyScheduleQuery}=await import('./ai-intent.js');
const stamp='2026-10-01T00:00:00Z';
const users=['v2-owner','v2-other'].map(id=>db.createUser({id,email:`${id}@example.invalid`,password_hash:'synthetic',role:'user',disabled:0,created_at:stamp,updated_at:stamp}));
function item(title:string,date:string,extra:Partial<Schedule>={}) {return schedules.createSchedule({id:randomUUID(),user_id:'v2-owner',calendar_id:'personal',type:'event',title,start_time:date,end_time:date,all_day:false,category:'life',priority:'medium',is_completed:false,is_repeated:false,reminders:[],is_high_risk:false,created_at:stamp,updated_at:stamp,...extra});}
const localNow=new Date('2026-10-01T09:45:00Z');
test('natural query and all relative dates use supplied anchor across midnight and year boundary',()=>{
  for(const q of ['今天有什么事情要干吗','今天有啥要做的','今天要做什么','查询明天安排'])assert.equal(isReadOnlyScheduleQuery(q),true,q);
  assert.equal(isReadOnlyScheduleQuery('把今天的会议改到明天'),false);
  assert.deepEqual(time.resolveQueryDates('明天','2026-12-31'),['2027-01-01']);
  assert.deepEqual(time.resolveQueryDates('下周一和周五','2026-10-01'),['2026-10-02','2026-10-05']);
  assert.deepEqual(time.resolveQueryDates('下周末','2026-10-01'),['2026-10-10','2026-10-11']);
  assert.equal(time.resolveQueryDates('下周','2026-10-01').length,7);
  assert.deepEqual(time.resolveQueryDates('2026-10-20','2026-10-01'),['2026-10-20']);
  assert.throws(()=>time.resolveQueryDates('2月30日','2026-10-01'),/日期无效/);
  assert.equal(time.dateInZone(new Date('2026-09-30T16:01:00Z'),'Asia/Hong_Kong'),'2026-10-01');
});
test('query includes account timezone and overlapping event, excludes unscheduled placeholder',()=>{
  const cross=item('cross','2026-09-30T23:30:00',{end_time:'2026-10-01T00:30:00'}),utc=item('UTC','2026-09-30T17:00:00Z',{end_time:'2026-09-30T18:00:00Z'}),hanging=item('hanging','2026-10-01T09:00:00',{is_unscheduled:true,type:'todo'});
  const found=schedulesForQuery('v2-owner','2026-10-01','Asia/Hong_Kong');
  assert.ok(found.some(s=>s.id===cross.id));assert.ok(found.some(s=>s.id===utc.id));assert.ok(!found.some(s=>s.id===hanging.id));assert.equal(schedulesForQuery('v2-other','2026-10-01','Asia/Hong_Kong').length,0);
});
test('one permanent main chat preserves old history and scoped chats enforce ownership',()=>{
  const old=store.createConversation('v2-owner','old');
  db.createAiScheduleMessage({id:'legacy-v2',user_id:'v2-owner',role:'user',type:'text',content:'legacy',intent:null,schedule_items:null,plan:null,created_at:stamp});
  const id=store.ensureDefaultConversation('v2-owner');assert.equal(id,old.id);assert.equal(store.listConversations('v2-owner')[0].title,'Orbit');assert.equal(db.getAiScheduleMessages('v2-owner',0)[0].conversation_id,id);
  assert.throws(()=>store.deleteConversation('v2-owner',id),/主对话/);assert.throws(()=>store.renameConversation('v2-owner',id,'renamed'),/固定/);
  const s=item('Scoped','2026-10-01T19:00:00'),scope=store.createConversation('v2-owner','Scoped',s.id);
  assert.ok(store.workingContext('v2-owner',scope.id,'这个','2026-10-01').includes(s.id));assert.throws(()=>store.createConversation('v2-other','forbidden',s.id),/事项/);
  const other=store.createConversation('v2-owner','separate');store.renameConversation('v2-owner',other.id,'target row');assert.equal(store.conversation('v2-owner',scope.id).title,'Scoped');
});
test('stats use same task cohort denominator, avoid projected cycles, account isolation and week/month/year boundaries',()=>{
  const s=item('Done','2026-10-01T18:00:00',{is_completed:true}),task=reminders.createReminderTask({userId:'v2-owner',type:'generic',name:'stats-cycle',config:{templateKey:'custom',rule:{frequency:'once',anchorDate:'2026-10-02',advancePolicy:'calendar'},reminderOffsets:[0],reminderTime:'12:00',priority:'medium',actionGuide:''}});
  sync.syncReminderTaskToCalendar(task);
  const data=stats.getOrbitStatistics('v2-owner','week','2026-10-01',localNow);
  assert.equal(data.window.start,'2026-09-28');assert.equal(data.window.end,'2026-10-04');assert.equal(data.details.filter(d=>d.title==='stats-cycle').length,1);
  assert.equal(data.tasks.total,data.tasks.completed+data.tasks.pending);assert.ok(data.tasks.unknownCompletedAt>=1);assert.ok(data.details.some(d=>d.id===s.id));
  assert.equal(stats.getOrbitStatistics('v2-other','week','2026-10-01',localNow).tasks.total,0);
  assert.equal(stats.getOrbitStatistics('v2-owner','year','2026-10-01',localNow).trend.length,12);
  assert.equal(time.statisticsPeriod('month','2028-02-15').end,'2028-02-29');
});
test('knowledge reads deduplicate reloads, citations count only actual referenced sources and backups do not double count',()=>{
  run('INSERT INTO library_entries (id,user_id,kind,type,title,content,content_hash,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',['entry-v2','v2-owner','article','knowledge','Entry','Body','synthetic-hash','active',stamp,stamp]);
  stats.recordKnowledgeRead('v2-owner','entry-v2',localNow);stats.recordKnowledgeRead('v2-owner','entry-v2',localNow);assert.throws(()=>stats.recordKnowledgeRead('v2-other','entry-v2',localNow),/不存在/);
  stats.recordKnowledgeRead('v2-owner','entry-v2',new Date('2026-10-01T10:01:00Z'));
  stats.recordKnowledgeCitations('v2-owner','answer',[{id:'entry-v2',referenced:true},{id:'entry-v2',referenced:true},{id:'missing',referenced:true}],localNow);
  stats.recordKnowledgeCitations('v2-owner','unused',[{id:'entry-v2',referenced:false}],localNow);
  let d=stats.getOrbitStatistics('v2-owner','week','2026-10-01',localNow);assert.equal(d.knowledge.reads,1);assert.equal(d.knowledge.citations,1);
  const exported=store.exportOrbit('v2-owner');store.restoreOrbit('v2-owner',exported,'merge');d=stats.getOrbitStatistics('v2-owner','week','2026-10-01',localNow);assert.equal(d.knowledge.reads,1);
});
test('proactive default is off; explicit reminder preserved, durable dedupe and unread main chat',async()=>{
  const s=item('Take parcel','2026-10-01T18:00:00',{location:'驿站',notes:'取件码',reminders:['15']});
  const old=proactive.setProactiveEnhancer(async()=> '提前准备取件码。');
  try {
    assert.equal((await proactive.runOrbitProactiveTick(localNow)).sent,0);proactive.setProactivePreference('v2-owner',true);
    assert.ok(proactive.proactiveCandidates('v2-owner').some(c=>c.schedule.id===s.id&&c.trigger==='2026-10-01T09:45:00.000Z'));
    assert.equal((await proactive.runOrbitProactiveTick(localNow)).sent,1);assert.equal((await proactive.runOrbitProactiveTick(localNow)).sent,0);
    schedules.updateSchedule(s.id,{notes:'Updated notes after notification'});assert.equal((await proactive.runOrbitProactiveTick(localNow)).sent,0);
    const main=store.listConversations('v2-owner')[0];assert.equal(main.unread,1);store.markConversationRead('v2-owner',main.id,localNow.toISOString());assert.equal(store.listConversations('v2-owner')[0].unread,0);
    assert.equal(queryAll<any>('SELECT * FROM orbit_proactive_events WHERE schedule_id=?',[s.id])[0].state,'sent');
  }finally{proactive.setProactiveEnhancer(old);proactive.setProactivePreference('v2-owner',false);}
});
test('AI result cannot send after task moves, completes, gets disabled or account turns off; no past flood',async()=>{
  const s=item('Race','2026-10-01T18:01:00');let release!:()=>void;
  const old=proactive.setProactiveEnhancer(async()=>{await new Promise<void>(r=>{release=r;});return 'old';});
  proactive.setProactivePreference('v2-owner',true);
  try {
    const work=proactive.runOrbitProactiveTick(new Date('2026-10-01T09:46:00Z'));
    for(let i=0;i<50&&!release;i++)await new Promise(r=>setTimeout(r,5));assert.ok(release);
    schedules.updateSchedule(s.id,{start_time:'2026-10-02T18:01:00',end_time:'2026-10-02T18:01:00'});release();assert.equal((await work).sent,0);
    proactive.setScheduleReminder('v2-owner',s.id,false,15);assert.ok(!proactive.proactiveCandidates('v2-owner').some(c=>c.schedule.id===s.id));
    item('Past','2020-01-01T09:00:00');assert.equal((await proactive.runOrbitProactiveTick(new Date('2026-10-01T10:00:00Z'))).sent,0);
  }finally{release?.();proactive.setProactiveEnhancer(old);proactive.setProactivePreference('v2-owner',false);}
});
test('snooze changes reminder only, tomorrow uses account morning, action is one-time and owner-only',async()=>{
  const s=item('Snooze','2026-10-01T18:05:00');const old=proactive.setProactiveEnhancer(async()=> '');proactive.setProactivePreference('v2-owner',true);
  try {
    const now=new Date('2026-10-01T09:50:00Z');assert.equal((await proactive.runOrbitProactiveTick(now)).sent,1);
    const event=queryAll<any>('SELECT * FROM orbit_proactive_events WHERE schedule_id=?',[s.id])[0];
    assert.throws(()=>proactive.actOnProactiveEvent('v2-other',event.id,'tomorrow',now),/不存在/);
    proactive.actOnProactiveEvent('v2-owner',event.id,'tomorrow',now);assert.equal(schedules.getSchedule(s.id)?.start_time,s.start_time);assert.equal(proactive.getScheduleReminder('v2-owner',s.id).snoozedUntil,'2026-10-02T01:00:00.000Z');assert.throws(()=>proactive.actOnProactiveEvent('v2-owner',event.id,'complete',now),/已处理/);
    assert.equal((await proactive.runOrbitProactiveTick(new Date('2026-10-02T01:00:00Z'))).sent,1);assert.equal((await proactive.runOrbitProactiveTick(new Date('2026-10-02T01:01:00Z'))).sent,0);
  }finally{proactive.setProactiveEnhancer(old);proactive.setProactivePreference('v2-owner',false);}
});
test('HTTP natural today query uses real schedules without an AI key; new endpoints require authentication and ownership',async()=>{
  const server=api.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const req=(url:string,user=0,method='GET',body?:unknown)=>fetch(base+url,{method,headers:{Authorization:'Bearer '+api.signUserToken(users[user]),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  try {
    assert.equal((await fetch(base+'/api/orbit/statistics')).status,401);assert.equal((await req('/api/orbit/statistics?period=invalid')).status,400);
    const today=time.dateInZone(new Date()),s=item('HTTP today',`${today}T18:00:00`),cid=store.ensureDefaultConversation('v2-owner'),id=randomUUID();
    assert.equal((await req('/api/orbit/requests',0,'POST',{requestId:id,conversationId:cid,text:'今天有什么事情要干吗'})).status,202);
    for(let i=0;i<100&&store.getRequest('v2-owner',id)?.state!=='completed';i++)await new Promise(r=>setTimeout(r,10));
    assert.equal(store.getRequest('v2-owner',id)?.state,'completed');assert.ok(JSON.parse(store.getRequest('v2-owner',id)!.result!).scheduleItems.some((x:any)=>x.id===s.id));
    assert.equal((await req(`/api/orbit/schedules/${s.id}/reminder`,1,'PATCH',{enabled:true,minutes:15})).status,400);
    assert.equal((await req('/api/orbit/knowledge/entry-v2/read',1,'POST',{})).status,400);
    assert.equal((await req(`/api/orbit/conversations/${cid}/read`,1,'POST',{})).status,400);
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
test('quiet hours suppress proactive chat; explicit zero minute reminders, completion and restore are safe',async()=>{
  const s=item('At start','2026-10-03T12:00:00',{reminders:['0']});const now=new Date('2026-10-03T04:00:00Z');const old=proactive.setProactiveEnhancer(async()=> '');
  db.upsertReminder({id:'v2-pref',user_id:'v2-owner',enabled:0,hour:8,minute:0,timezone:'Asia/Shanghai',quiet_hours_enabled:1,quiet_start:'11:00',quiet_end:'13:00',created_at:stamp,updated_at:stamp});proactive.setProactivePreference('v2-owner',true);
  try{
    assert.equal((await proactive.runOrbitProactiveTick(now)).sent,0);db.upsertReminder({...db.getReminder('v2-owner')!,quiet_hours_enabled:0});
    assert.equal((await proactive.runOrbitProactiveTick(now)).sent,1);const e=queryAll<any>('SELECT * FROM orbit_proactive_events WHERE schedule_id=?',[s.id])[0];
    proactive.actOnProactiveEvent('v2-owner',e.id,'complete',now);assert.equal(schedules.getSchedule(s.id)?.is_completed,true);assert.equal((await proactive.runOrbitProactiveTick(now)).sent,0);
    const snapshot=store.exportOrbit('v2-owner');store.restoreOrbit('v2-owner',snapshot,'replace');assert.equal(proactive.getProactivePreference('v2-owner'),false);assert.equal(store.listConversations('v2-owner').filter(c=>c.is_main===1).length,1);
  }finally{proactive.setProactiveEnhancer(old);proactive.setProactivePreference('v2-owner',false);}
});
test('cycle proactive completion records one real cycle and its next projection; no deadline or recurrence change',async()=>{
  const task=reminders.createReminderTask({userId:'v2-owner',type:'generic',name:'proactive-cycle',config:{templateKey:'custom',rule:{frequency:'interval',anchorDate:'2026-10-04',interval:7,unit:'day',advancePolicy:'calendar'},reminderOffsets:[0],reminderTime:'12:00',priority:'medium',actionGuide:''}});sync.syncReminderTaskToCalendar(task);
  const old=proactive.setProactiveEnhancer(async()=> ''),now=new Date('2026-10-04T04:00:00Z');proactive.setProactivePreference('v2-owner',true);
  const before=stats.getOrbitStatistics('v2-owner','week','2026-10-04',now).tasks.actualCompleted;
  try{
    assert.equal((await proactive.runOrbitProactiveTick(now)).sent,1);const e=queryAll<any>('SELECT * FROM orbit_proactive_events WHERE instance_id=?',[task.currentCycle!.id])[0];proactive.actOnProactiveEvent('v2-owner',e.id,'complete',now);
    assert.equal(reminders.getReminderHistory(task.id,'v2-owner').find(c=>c.id===task.currentCycle!.id)?.status,'completed');assert.equal(schedules.getSchedule(`reminder-cycle:${task.currentCycle!.id}`)?.is_completed,true);
    const next=reminders.getReminderTask(task.id,'v2-owner')!;assert.ok(next.currentCycle!.dueDate>task.currentCycle!.dueDate);assert.equal(next.currentCycle?.plannedDate,null);assert.ok(schedules.getSchedule(`reminder-cycle:${next.currentCycle!.id}`));
    assert.equal(stats.getOrbitStatistics('v2-owner','week','2026-10-04',now).tasks.actualCompleted,before+1);
  }finally{proactive.setProactiveEnhancer(old);proactive.setProactivePreference('v2-owner',false);}
});
test('proactive worker lifecycle is independent from mail and other background jobs',async()=>{
  const {createRuntime}=await import('./runtime/bootstrap.js');let proactiveStarts=0,mailStarts=0,stops=0;
  const runtime=createRuntime({app:api.app,initializeServer:async()=>{},runtimeConfig:{PORT:'0',backgroundJobsEnabled:false},backgroundJobs:{start(){mailStarts++;},async stop(){}},proactiveJobs:{start(){proactiveStarts++;},async stop(){stops++;}},runtimeProactiveEnabled:true,logServiceStarted(){}});
  await runtime.start();await runtime.start();assert.equal(proactiveStarts,1);assert.equal(mailStarts,0);await runtime.stop();assert.equal(stops,1);
});
test('reports dedupe same date/source and exclude candidates; initial and unchanged knowledge versions are not updates',async()=>{
  const activity=await import('./activity-store.js');
  for(const [source,status] of [['local','received'],['local','received'],['cloud','received'],['cloud','candidate']] as const)activity.createDailyReport({userId:'v2-owner',reportDate:'2026-10-01',source,deliveryStatus:status,markdown:'synthetic',contentHash:randomUUID()});
  for(const [i,hash] of ['baseline','changed','changed'].entries())run('INSERT INTO library_entry_versions (id,entry_id,user_id,content_hash,content,created_at) VALUES (?,?,?,?,?,?)',[`v2-version-${i}`,'entry-v2','v2-owner',hash,'synthetic',`2026-10-01T0${i}:00:00Z`]);
  const data=stats.getOrbitStatistics('v2-owner','week','2026-10-01',localNow);assert.equal(data.reports.total,2);assert.equal(data.reportDetails.length,2);assert.equal(data.reports.candidates,1);assert.equal(data.knowledge.updates,1);
  assert.equal(stats.getOrbitStatistics('v2-owner','week','2026-10-01',localNow,{reportSource:'cloud'}).reports.total,1);
  assert.equal(stats.getOrbitStatistics('v2-owner','month','2020-01-01',localNow).historyTracked,false);
});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
