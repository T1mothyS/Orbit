import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {NotificationChannel} from './activity-store.js';
import sharp from 'sharp';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-connected-test-'));
Object.assign(process.env,{DATA_DIR:root,NODE_ENV:'test',APP_ENV:'development',JWT_SECRET:'synthetic-connected-only',BACKGROUND_JOBS_ENABLED:'false',ORBIT_PROACTIVE_ENABLED:'false'});
const api=await import('./index.js');await api.initializeServer();
const db=await import('./db.js'),schedules=await import('./schedule-store.js'),activity=await import('./activity-store.js'),chat=await import('./notification-chat.js'),orbit=await import('./orbit-store.js'),reports=await import('./activity-reports.js'),stats=await import('./orbit-statistics.js'),proactive=await import('./orbit-proactive.js'),completion=await import('./schedule-completion-service.js'),profiles=await import('./orbit-profile.js');
const {queryAll,queryOne,run}=await import('./database/connection.js');
const {withPersistenceTransaction}=await import('./persistence.js');
const {safeOrbitLink}=await import('../src/utils/orbit-links.js');
const {findSettings}=await import('../src/utils/settings-registry.js');
const stamp=new Date().toISOString();
for(const id of ['connected-owner','connected-other'])db.createUser({id,email:id+'@example.invalid',password_hash:'synthetic-only',role:'user',disabled:0,created_at:stamp,updated_at:stamp});
const owner='connected-owner',other='connected-other';
function item(title:string,extra:Record<string,any>={}){return schedules.createSchedule({id:randomUUID(),user_id:owner,calendar_id:'personal',type:'event',title,start_time:stamp,end_time:stamp,all_day:false,category:'work',priority:'medium',is_completed:false,is_repeated:false,reminders:[],is_high_risk:false,...extra});}
function notification(id:string,at=stamp,channel:NotificationChannel='in_app',kind='due'){return activity.enqueueNotificationDetailed({userId:owner,sourceType:'schedule',sourceId:id,channel,kind,title:'提醒',body:'请查看当前事项',scheduledAt:at,dedupeKey:randomUUID()}).notification;}
const range={period:'custom',from:new Date(Date.now()-86400000).toISOString(),to:new Date(Date.now()+86400000).toISOString()};
function data(){return stats.getOrbitStatistics(owner,'custom',undefined,new Date(),range);}

test('in-app messages and queue state commit together, same point dedupes across kinds and restart',async()=>{
  chat.setInAppEnabled(owner,true);const task=item('durable'),n=notification(task.id);
  assert.throws(()=>withPersistenceTransaction(()=>{chat.deliverInApp(n);throw new Error('rollback');}),/rollback/);
  assert.equal(activity.getNotification(n.id)!.status,'pending');assert.equal(queryOne('SELECT message_id FROM orbit_notification_messages WHERE notification_id=?',[n.id]),undefined);
  const message=chat.deliverInApp(n)!;assert.ok(message);assert.equal(activity.getNotification(n.id)!.status,'sent');assert.equal(activity.getNotification(n.id)!.readAt,null);assert.equal(schedules.getSchedule(task.id)!.is_completed,false);
  assert.equal(chat.deliverInApp(notification(task.id,stamp,'in_app','proactive')),message);
  await activity.initActivityDb();assert.equal(chat.deliverInApp(n),message);assert.equal(queryAll('SELECT id FROM ai_schedule_messages WHERE id=?',[message]).length,1);
  activity.markNotificationRead(n.id,owner);assert.ok(chat.notificationView(owner,n.id).readAt);assert.equal(chat.notificationView(other,n.id).state,'discarded');assert.throws(()=>chat.eventForNotification(other,n.id),/失效/);
  const event=chat.eventForNotification(owner,n.id);proactive.actOnProactiveEvent(owner,event,'complete');assert.ok(schedules.getSchedule(task.id)!.is_completed);assert.equal(chat.notificationView(owner,n.id).state,'handled');assert.equal(activity.getNotification(n.id)!.status,'sent');assert.throws(()=>proactive.actOnProactiveEvent(owner,event,'complete'),/已处理/);
});
test('disabled channel, stale object and quiet time do not deliver actionable cards',()=>{
  const task=item('changes'),n=notification(task.id);chat.deliverInApp(n);schedules.updateSchedule(task.id,{start_time:new Date(Date.now()+3600000).toISOString(),end_time:new Date(Date.now()+7200000).toISOString()});assert.equal(chat.notificationView(owner,n.id).state,'discarded');assert.throws(()=>chat.eventForNotification(owner,n.id),/失效/);
  chat.setInAppEnabled(owner,false);const off=notification(item('off').id);chat.processInAppNotifications(new Date(Date.now()+1000));assert.equal(activity.getNotification(off.id)!.status,'suppressed');chat.setInAppEnabled(owner,true);
  const pref=db.getReminder(owner)!;db.upsertReminder({...pref,quiet_hours_enabled:1,quiet_start:'00:00',quiet_end:'23:59'});const quiet=notification(item('quiet').id);chat.processInAppNotifications(new Date());assert.equal(activity.getNotification(quiet.id)!.status,'pending');assert.ok(activity.getNotification(quiet.id)!.nextRetryAt);db.upsertReminder({...pref,quiet_hours_enabled:0});
});
test('selected notification context is owner scoped, survives recent history limits, and clears stale links', async () => {
  chat.setInAppEnabled(owner,true);
  const task=item('context source'),n=notification(task.id);chat.deliverInApp(n);
  const cid=orbit.ensureDefaultConversation(owner);
  for(let i=0;i<25;i++)db.createAiScheduleMessage({id:randomUUID(),user_id:owner,conversation_id:cid,role:'user',type:'text',content:`later ${i}`,intent:null,schedule_items:null,plan:null,created_at:new Date(Date.now()+i+1000).toISOString()});
  const selected=chat.notificationContinuation(owner,n.id);
  assert.equal(selected.title,'提醒');assert.equal(selected.body,'请查看当前事项');assert.equal(selected.sourceId,task.id);assert.equal(selected.state,'sent');assert.ok(selected.createdAt);
  assert.throws(()=>chat.notificationContinuation(other,n.id),/不存在或无权/);
  schedules.updateSchedule(task.id,{is_completed:true});assert.equal(chat.notificationContinuation(owner,n.id).state,'handled');
  const queue=await import('./orbit-queue.js'),previous=queue.setOrbitWorker(async(_req,res)=>{res.json({success:true,reply:'synthetic'});});
  try {
    const id=randomUUID(),body={requestId:id,conversationId:cid,text:'同样问题',notificationId:n.id};
    queue.submitOrbitRequest(owner,body);queue.submitOrbitRequest(owner,body);
    const second=notification(item('second context').id);
    assert.throws(()=>queue.submitOrbitRequest(owner,{...body,notificationId:second.id}),/其他内容/);
    assert.throws(()=>queue.submitOrbitRequest(owner,{...body,notificationId:undefined}),/其他内容/);
    assert.throws(()=>queue.submitOrbitRequest(other,{...body,requestId:randomUUID(),conversationId:orbit.ensureDefaultConversation(other)}),/不存在或无权/);
    for(let i=0;i<100&&orbit.getRequest(owner,id)?.state==='running';i++)await new Promise(resolve=>setTimeout(resolve,5));
  } finally {queue.setOrbitWorker(previous);}
  schedules.deleteSchedule(task.id);const view=chat.notificationView(owner,n.id);assert.equal(view.href,null);assert.equal(view.canContinue,false);assert.throws(()=>chat.notificationContinuation(owner,n.id),/失效/);
  assert.deepEqual(chat.notificationView(owner,'missing'),{state:'discarded',canContinue:false,href:null,object:null,actionable:false});
});
test('half-open statistics include undated todos, exclude reopened completion and distinguish rescheduling',()=>{
  run('UPDATE orbit_metrics_meta SET value=? WHERE key=?',[range.from,'activity_tracking_since']);const todo=item('undated',{type:'todo',is_unscheduled:true});
  const before=data();assert.ok(before.activity.metricDetails.created.some(d=>d.id===todo.id));assert.ok(before.activity.metricDetails.backlog.some(d=>d.id===todo.id));
  completion.toggleScheduleCompletion(todo.id,owner);assert.ok(data().activity.metricDetails.completed.some(d=>d.title==='undated'));completion.toggleScheduleCompletion(todo.id,owner);assert.ok(!data().activity.metricDetails.completed.some(d=>d.title==='undated'));
  const timed=item('reschedule');const count=data().activity.rescheduled;schedules.updateSchedule(timed.id,{notes:'ordinary edit'});assert.equal(data().activity.rescheduled,count);schedules.updateSchedule(timed.id,{start_time:new Date(Date.now()+7200000).toISOString(),end_time:new Date(Date.now()+10800000).toISOString()});assert.equal(data().activity.rescheduled,count!+1);
  activity.createCompletion({userId:owner,sourceType:'schedule',sourceId:todo.id,completedAt:range.to});assert.ok(!data().activity.metricDetails.completed.some(d=>d.title==='undated'));
  const d=data();assert.equal(d.activity.actualCompleted,d.activity.metricDetails.completed.length);assert.equal(d.activity.aiConfirmed,d.activity.metricDetails.ai.length);assert.equal(d.activity.created,d.activity.daily.reduce((n,r)=>n+r.created,0));assert.equal(d.activity.sources.reduce((n,s)=>n+s.count,0),d.activity.created);
  const beforeHeat=d.activity.heatmap.flat().reduce((a,b)=>a+b,0);const n=notification(item('system').id);chat.deliverInApp(n);assert.equal(data().activity.heatmap.flat().reduce((a,b)=>a+b,0),beforeHeat+1); // task creation only
  assert.equal(stats.getOrbitStatistics(other,'custom',undefined,new Date(),range).activity.created,0);
  assert.throws(()=>stats.getOrbitStatistics(owner,'custom',undefined,new Date(),{from:'2026-10-01',to:'2026-10-02'}),/时区/);
  run('UPDATE orbit_metrics_meta SET value=? WHERE key=?',[range.to,'activity_tracking_since']);assert.equal(data().activity.rescheduled,null);run('UPDATE orbit_metrics_meta SET value=? WHERE key=?',[range.from,'activity_tracking_since']);
});
test('AI provider instructions include the selected notification beyond twenty messages without profile input',async()=>{
  const task=item('prompt context'),n=activity.enqueueNotificationDetailed({userId:owner,sourceType:'schedule',sourceId:task.id,channel:'in_app',kind:'due',title:'唯一关联通知标题',body:'唯一关联通知正文',scheduledAt:stamp,dedupeKey:randomUUID()}).notification;
  chat.deliverInApp(n);const cid=orbit.ensureDefaultConversation(owner);
  for(let i=0;i<25;i++)db.createAiScheduleMessage({id:randomUUID(),user_id:owner,conversation_id:cid,role:'user',type:'text',content:`prompt later ${i}`,intent:null,schedule_items:null,plan:null,created_at:new Date(Date.now()+i+1000).toISOString()});
  assert.doesNotMatch(orbit.historyContext(owner,cid),/唯一关联通知正文/);
  db.upsertUserApiKey({id:randomUUID(),user_id:owner,api_key:'synthetic-only',base_url:null,created_at:stamp,updated_at:stamp});
  const cloud=await import('./daily-report-cloud-store.js');cloud.saveDailyReportCloudContext(owner,{profile:{background:{career_context:'不可加入普通AI的个人资料'}}},0);
  const {workBuddyProvider}=await import('./ai-provider-workbuddy.js'),original=workBuddyProvider.generate;
  let instructions='';workBuddyProvider.generate=async request=>{instructions=request.instructions;return JSON.stringify({intent:'chat',reply:'合成回应',operations:[]});};
  const server=api.app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  try {
    const id=randomUUID(),base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
    const response=await fetch(base+'/api/orbit/requests',{method:'POST',headers:{Authorization:'Bearer '+api.signUserToken(db.getUserById(owner)!),'Content-Type':'application/json'},body:JSON.stringify({requestId:id,conversationId:cid,text:'请解释这条通知',notificationId:n.id})});assert.equal(response.status,202);
    for(let i=0;i<200&&['queued','running'].includes(orbit.getRequest(owner,id)?.state||'');i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(orbit.getRequest(owner,id)?.state,'completed');assert.match(instructions,/唯一关联通知标题/);assert.match(instructions,/唯一关联通知正文/);assert.match(instructions,/scheduledAt/);assert.match(instructions,/sourceType/);assert.doesNotMatch(instructions,/不可加入普通AI的个人资料/);
  } finally {workBuddyProvider.generate=original;db.deleteUserApiKey(owner);await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('weekly defaults, DST-aware consecutive cutoffs, snapshot idempotency, ownership and bounded insights',async()=>{
  assert.equal(reports.getWeeklyPreferences(owner).enabled,false);assert.equal(reports.getWeeklyPreferences(owner).hour,20);assert.throws(()=>reports.setWeeklyPreferences(owner,{enabled:true,weekday:9,hour:20,minute:0}),/格式/);
  const prefs={weekday:0,hour:20,minute:0,timezone:'America/New_York'};const cutoff=reports.weeklyCutoff(new Date('2026-11-02T02:00Z'),prefs);assert.equal(cutoff.toISOString(),'2026-11-02T01:00:00.000Z');const previous=reports.weeklyCutoff(new Date(cutoff.getTime()-1),prefs);assert.equal(previous.toISOString(),'2026-10-26T00:00:00.000Z');assert.equal(cutoff.getTime()-previous.getTime(),169*3600000);
  const report=reports.createActivityReport(owner,range);assert.equal(reports.createActivityReport(owner,range).id,report.id);assert.throws(()=>reports.getActivityReport(other,report.id),/无权/);
  const old=reports.setReportInsightGenerator(async(_provider,request)=>{assert.equal(request.tools,undefined);assert.ok(request.input[0].text!.length<=16000);return JSON.stringify({insights:[{text:'本期完成 '+report.snapshot.activity.actualCompleted+' 项，建议核对当前积压。',metrics:['completed','backlog'],objects:[]},{text:'工作 99 小时',metrics:['completed'],objects:[]}]});});
  try{const insights=await reports.generateReportInsights(owner,report.id);assert.equal(insights.insights.length,1);reports.setReportInsightGenerator(async()=>{throw new Error('synthetic model failure');});const failed=await reports.generateReportInsights(owner,report.id);assert.equal(failed.snapshotHash,report.snapshotHash);assert.match(failed.insightError!,/synthetic/);assert.equal(reports.getWeeklyPreferences(owner).enabled,false);}finally{reports.setReportInsightGenerator(old);}
  item('new evidence');assert.equal(reports.activityReportFreshness(owner,report.id).changed,true);assert.equal(reports.getActivityReport(owner,report.id).snapshot.activity.created,report.snapshot.activity.created);
  const first=reports.deliverActivityReport(owner,report.id);const second=reports.deliverActivityReport(owner,report.id);assert.equal(first[0].notification.id,second[0].notification.id);assert.equal(reports.reportDeliveryStatus(owner,report.id).length,first.length);
});
test('scheduler fills only most recent missed cutoff, no replay after restart, disabled remains disabled',async()=>{
  const old=reports.setReportInsightGenerator(async()=>{throw new Error('offline');});try{
    reports.setWeeklyPreferences(owner,{enabled:true,weekday:0,hour:20,minute:0},new Date('2026-09-01T00:00Z'));
    const now=new Date('2026-10-04T13:00Z');await reports.runWeeklyReports(now);const scheduled=queryAll<any>('SELECT * FROM orbit_activity_reports WHERE user_id=? AND auto_cutoff IS NOT NULL',[owner]);assert.equal(scheduled.length,1);assert.equal(scheduled[0].range_end,'2026-10-04T12:00:00.000Z');assert.equal(scheduled[0].range_start,'2026-09-27T12:00:00.000Z');
    await reports.runWeeklyReports(now);assert.equal(queryAll('SELECT id FROM orbit_activity_reports WHERE auto_cutoff IS NOT NULL').length,1);reports.setWeeklyPreferences(owner,{enabled:false,weekday:0,hour:20,minute:0},now);await reports.runWeeklyReports(new Date('2026-10-18T13:00Z'));assert.equal(queryAll('SELECT id FROM orbit_activity_reports WHERE auto_cutoff IS NOT NULL').length,1);
  }finally{reports.setReportInsightGenerator(old);}
});
test('avatar validates bytes, strips metadata, backup restores evidence but never turns on automatic weekly',async()=>{
  const png=await sharp({create:{width:600,height:300,channels:3,background:'#663399'}}).png().toBuffer();await profiles.saveAvatar(owner,{mimeType:'image/png',base64:png.toString('base64')});const encoded=profiles.avatarBytes(owner);const meta=await sharp(encoded).metadata();assert.equal(meta.width,256);assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);assert.throws(()=>profiles.avatarBytes(other),/不存在/);
  await assert.rejects(profiles.saveAvatar(owner,{mimeType:'image/png',base64:Buffer.from('not an image').toString('base64')}));await assert.rejects(profiles.saveAvatar(owner,{mimeType:'image/png',base64:Buffer.alloc(5*1024*1024+1).toString('base64')}),/5 MB/);
  reports.setWeeklyPreferences(owner,{enabled:true,weekday:0,hour:20,minute:0});const backup=orbit.exportOrbit(owner);orbit.restoreOrbit(owner,backup,'replace');assert.equal(reports.getWeeklyPreferences(owner).enabled,false);assert.ok(profiles.getProfile(owner).avatarId);assert.equal(reports.listActivityReports(owner).length,backup.connected.reports.length);
  orbit.restoreOrbit(other,backup,'merge',true);assert.equal(reports.getWeeklyPreferences(other).enabled,false);const restored=reports.getActivityReport(other,reports.listActivityReports(other)[0].id);const restoredEvents=queryAll('SELECT id FROM orbit_activity_events WHERE user_id=?',[other]).length;orbit.restoreOrbit(other,backup,'merge',true);assert.equal(queryAll('SELECT id FROM orbit_activity_events WHERE user_id=?',[other]).length,restoredEvents);assert.ok(Object.values(restored.snapshot.activity.metricDetails).flat().every(d=>d.href===null));profiles.removeAvatar(owner);assert.equal(profiles.getProfile(owner).avatarId,null);
});
test('link protocol filtering and shared settings indexing exclude admin secrets',async()=>{
  for(const input of ['javascript:alert(1)','data:text/html,hi','//evil.invalid','/\\evil.invalid','https://user:pass@evil.invalid'])assert.equal(safeOrbitLink(input,'https://orbit.invalid'),null,input);
  const {webSearchStep}=await import('./chatgpt-web-search.js');assert.equal(webSearchStep({action:{sources:[{url:'https://example.invalid'},{url:'javascript:alert(1)'}]}},'source',stamp,'completed').resultCount,1);assert.equal(webSearchStep({action:{}},'empty',stamp,'completed').resultCount,0);
  assert.equal(safeOrbitLink('https://orbit.invalid/assistant?note=x','https://orbit.invalid'),'/assistant?note=x');assert.ok(findSettings('头像').some(s=>s.label==='用户头像'));assert.ok(findSettings('周报').some(s=>s.label==='Orbit Weekly'));assert.ok(findSettings('管理员',false).every(s=>s.section!=='admin'));
});
test('HTTP confirmed AI create -> durable notification -> complete -> stats -> report -> precise owned object',async()=>{
  const server=api.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address() as any;const base=`http://127.0.0.1:${address.port}`;
  const token=api.signUserToken(db.getUserById(owner)!);const headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'};
  const call=async(url:string,body?:unknown)=>{const r=await fetch(base+url,{headers,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,200,JSON.stringify(d));return d;};
  try{const state=await import('./ai-chat-state.js');const plan:any={id:randomUUID(),userId:owner,conversationId:orbit.ensureDefaultConversation(owner),targetCalendarId:'personal',today:stamp.slice(0,10),intent:'create',reply:'合成草稿',warnings:[],revision:1,state:'pending',expiresAt:Date.now()+60000,operations:[{key:'0',type:'create',data:{title:'connected AI task',start_time:stamp,end_time:stamp}}]};plan.historyMessageId=randomUUID();const {buildAiPlanSnapshot}=await import('./ai-plan.js');db.createAiScheduleMessage({id:plan.historyMessageId,user_id:owner,conversation_id:plan.conversationId,role:'assistant',type:'plan',content:plan.reply,intent:'create',plan:JSON.stringify(buildAiPlanSnapshot(plan)),schedule_items:null,created_at:stamp});state.activateAiPlan(plan);
    const created=await call('/api/ai-chat/confirm',{planId:plan.id,expectedRevision:1});const task=created.changedDetails.created[0];assert.ok(task.id);await call('/api/ai-chat/confirm',{planId:plan.id,expectedRevision:1});const n=notification(task.id);chat.deliverInApp(n);await call('/api/orbit/notifications/'+n.id+'/complete',{});
    const d=await call('/api/orbit/statistics?'+new URLSearchParams(range));assert.ok(d.activity.metricDetails.completed.some((v:any)=>v.title==='connected AI task'));assert.equal(d.activity.metricDetails.ai.filter((v:any)=>v.title.includes('connected AI task')).length,1);const report=await call('/api/orbit/activity-reports',range);assert.ok(report.snapshot.activity.metricDetails.completed.find((v:any)=>v.title==='connected AI task').href.includes('schedule='+task.id));
    const delivery=await call('/api/orbit/activity-reports/'+report.id+'/deliver',{confirm:true});assert.ok(delivery.deliveries.some((d:any)=>d.channel==='in_app'&&d.status==='sent'));assert.match(reports.renderActivityReport(reports.getActivityReport(owner,report.id)),/主要推进[\s\S]*connected AI task[\s\S]*活动节奏/);const imported=activity.createAiImport({userId:owner,sourceType:'text',inputText:'synthetic import',draft:{kind:'todo',title:'confirmed AI import',dueDate:stamp.slice(0,10),dueTime:'12:00',reminderOffsets:[]}});await call('/api/ai/imports/'+imported.id+'/confirm',{});await call('/api/ai/imports/'+imported.id+'/confirm',{});assert.equal(data().activity.metricDetails.ai.filter(d=>d.title.includes('confirmed AI import')).length,1);assert.equal(data().activity.metricDetails['source:import'].filter(d=>d.title==='confirmed AI import').length,1);assert.equal((await fetch(base+'/api/orbit/activity-reports/'+report.id)).status,401);const foreign=api.signUserToken(db.getUserById(other)!);assert.equal((await fetch(base+'/api/orbit/activity-reports/'+report.id,{headers:{Authorization:'Bearer '+foreign}})).status,400);
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});


test('cycle arrangement uses its timezone and excludes the exact range end; daily totals survive historical completion dates',async()=>{
  const reminders=await import('./reminder-store.js');
  const user='connected-cycle';db.createUser({id:user,email:user+'@example.invalid',password_hash:'synthetic-only',role:'user',disabled:0,created_at:stamp,updated_at:stamp});
  const task=reminders.createReminderTask({userId:user,type:'generic',name:'range-boundary cycle',timezone:'America/New_York',config:{templateKey:'custom',rule:{frequency:'once',anchorDate:'2026-10-04',advancePolicy:'calendar'},reminderOffsets:[0],reminderTime:'09:00',actionGuide:'synthetic',priority:'medium'}});
  const before=stats.getOrbitStatistics(user,'custom',undefined,new Date(),{from:'2026-10-04T00:00:00Z',to:'2026-10-04T13:00:00Z'});assert.equal(before.tasks.total,0);
  const after=stats.getOrbitStatistics(user,'custom',undefined,new Date(),{from:'2026-10-04T13:00:00Z',to:'2026-10-04T13:00:01Z'});assert.equal(after.tasks.total,1);
  activity.createCompletion({userId:user,sourceType:'reminder',sourceId:task.id,instanceId:task.currentCycle!.id,completedAt:'2026-10-02T04:00:00Z'});
  const historical=stats.getOrbitStatistics(user,'custom',undefined,new Date(),{from:'2026-10-02T00:00:00Z',to:'2026-10-03T00:00:00Z'});assert.equal(historical.activity.actualCompleted,1);assert.equal(historical.activity.daily.reduce((n,d)=>n+d.completed,0),1);
});

test('changing the enabled weekly time preserves the last delivered cutoff without gaps',async()=>{
  const user='connected-continuity';db.createUser({id:user,email:user+'@example.invalid',password_hash:'synthetic-only',role:'user',disabled:0,created_at:stamp,updated_at:stamp});chat.setInAppEnabled(user,true);
  reports.setWeeklyPreferences(user,{enabled:true,weekday:0,hour:20,minute:0},new Date('2026-10-03T00:00:00Z'));const old=reports.setReportInsightGenerator(async()=>{throw new Error('offline');});
  try{await reports.runWeeklyReports(new Date('2026-10-04T13:00:00Z'));reports.setWeeklyPreferences(user,{enabled:true,weekday:0,hour:21,minute:0},new Date('2026-10-05T00:00:00Z'));await reports.runWeeklyReports(new Date('2026-10-11T14:00:00Z'));const rows=queryAll<any>('SELECT range_start,range_end FROM orbit_activity_reports WHERE user_id=? AND auto_cutoff IS NOT NULL ORDER BY range_end',[user]);assert.equal(rows.length,2);assert.equal(rows[0].range_end,rows[1].range_start);assert.equal(rows[1].range_end,'2026-10-11T13:00:00.000Z');
  }finally{reports.setReportInsightGenerator(old);}
});

test('browser channel readiness is independent from mail jobs and restored pending notifications never replay',async()=>{
  const pref=db.getReminder(owner)!;db.upsertReminder({...pref,browser_enabled:1,quiet_hours_enabled:0});const n=notification(item('browser independent').id,stamp,'browser');chat.processInAppNotifications();assert.equal(activity.getNotification(n.id)!.status,'sent');
  db.upsertReminder({...db.getReminder(owner)!,browser_enabled:0});const disabled=notification(item('disabled browser').id,stamp,'browser');await (await import('./notification-service.js')).processNotificationQueue();assert.equal(activity.getNotification(disabled.id)!.status,'suppressed');const pending=notification(item('restore pending').id);const backup=orbit.exportOrbit(owner),activityBackup=activity.exportUserActivity(owner);withPersistenceTransaction(()=>{activity.restoreUserActivity(owner,activityBackup,'replace');orbit.restoreOrbit(owner,backup,'replace');});assert.equal(activity.getNotification(pending.id)!.status,'suppressed');chat.processInAppNotifications();assert.equal(queryOne('SELECT message_id FROM orbit_notification_messages WHERE notification_id=?',[pending.id]),undefined);assert.equal(reports.getWeeklyPreferences(owner).enabled,false);
});


test('encrypted account backup restores avatar bytes and report snapshots with automation disabled',async()=>{
  const backups=await import('./backup-service.js');const image=await sharp({create:{width:100,height:100,channels:3,background:'#127b61'}}).png().toBuffer();await profiles.saveAvatar(owner,{mimeType:'image/png',base64:image.toString('base64')});const bytes=profiles.avatarBytes(owner);reports.setWeeklyPreferences(owner,{enabled:true,weekday:0,hour:20,minute:0});const frozen=reports.createActivityReport(owner,range);const backup=backups.createUserBackup(owner,'synthetic-backup-password');profiles.removeAvatar(owner);backups.restoreUserBackup(owner,backup,'synthetic-backup-password','replace');assert.deepEqual(profiles.avatarBytes(owner),bytes);assert.equal(reports.getActivityReport(owner,frozen.id).snapshotHash,frozen.snapshotHash);assert.equal(reports.getWeeklyPreferences(owner).enabled,false);
});
