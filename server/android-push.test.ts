import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import express from 'express';
import type {Message} from 'firebase-admin/messaging';

process.env.DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-android-push-'));
const db=await import('./db.js'),conn=await import('./database/connection.js'),activity=await import('./activity-store.js'),schedules=await import('./schedule-store.js'),reminders=await import('./reminder-store.js'),push=await import('./android-push.js');
await db.initDb();await activity.initActivityDb();await schedules.initScheduleDb();await reminders.initReminderDb();
const uid='android-owner',other='android-other',stamp=new Date().toISOString();
for(const id of [uid,other])db.createUser({id,email:`${id}@example.invalid`,password_hash:'synthetic',role:'user',disabled:0,created_at:stamp,updated_at:stamp});
const key=()=>randomUUID()+randomUUID();
const deviceInput=(fid:string|null='a'.repeat(22))=>({installationId:randomUUID(),installationKey:key(),fid,permission:true,label:'synthetic Android',version:'test'});
const makeSchedule=(id:string,start:string)=>schedules.createSchedule({id,user_id:uid,calendar_id:'personal',title:'事项标题',type:'event',start_time:start,end_time:start,all_day:false,is_unscheduled:false,is_completed:false,is_repeated:false,category:'work',priority:'medium',reminders:['0'],is_high_risk:false});
const now=()=>new Date();
const delivery=(id:string)=>conn.queryOne<import('./android-push.js').PushDelivery>('SELECT * FROM android_push_deliveries WHERE id=?',[id])!;
const calls:Message[]=[];
push.setPushSender(async message=>{calls.push(message);return 'projects/synthetic/messages/accepted';});
function reset(){for(const s of schedules.getAllSchedules(uid))schedules.updateSchedule(s.id,{is_completed:true});conn.run('DELETE FROM reminders WHERE user_id=?',[uid]);for(const table of ['android_push_deliveries','android_push_devices','android_push_preferences'])conn.run(`DELETE FROM ${table}`);calls.length=0;push.setPushSender(async message=>{calls.push(message);return 'accepted';});}

test('installation proof, ownership, identity rotation, account switch and revoke compensation',()=>{
  reset();const input=deviceInput(),d=push.registerDevice(uid,input);
  assert.equal(push.pushEnabled(uid),false);
  assert.deepEqual(push.registerDevice(uid,input),d);
  assert.throws(()=>push.registerDevice(other,{...input,installationKey:key()}),/设备身份/);
  assert.throws(()=>push.revokeDevice(other,d.id),/不存在/);
  const refreshed=push.registerDevice(uid,{...input,fid:'b'.repeat(22)});assert.notEqual(refreshed.generation,d.generation);
  assert.throws(()=>push.registerDevice(other,deviceInput('b'.repeat(22))),/已绑定/);
  const changed=push.registerDevice(other,{...input,fid:'b'.repeat(22)});
  assert.equal(push.publicDevices(uid).length,0);assert.equal(push.publicDevices(other).length,1);
  push.revokeByCapability(changed.id,refreshed.generation,input.installationKey);assert.equal(push.publicDevices(other).length,1,'stale compensation cannot revoke new account');
  assert.throws(()=>push.revokeByCapability(changed.id,changed.generation,key()),/无效/);
  push.revokeByCapability(changed.id,changed.generation,input.installationKey);assert.equal(push.publicDevices(other).length,0);
  assert.ok(!JSON.stringify(push.publicDevices(other)).includes(input.installationKey));
});
test('missing Firebase configuration still permits permission and local-only device binding',()=>{
  reset();const input=deviceInput(null),d=push.registerDevice(uid,input);
  assert.equal(d.registered,false);assert.equal(push.publicDevices(uid)[0].registered,false);
  assert.throws(()=>push.queuePushTest(uid,d.id),/注册/);
});
test('reminder per-device scan dedupes, preserves title/time privacy, and permits zero-minute reminders',async()=>{
  reset();const time=now(),id='android-zero';makeSchedule(id,time.toISOString());
  const a=push.registerDevice(uid,deviceInput()),b=push.registerDevice(uid,deviceInput('b'.repeat(22)));
  schedules.updateSchedule(id,{notes:'private-note',location:'private-location'});push.setPushEnabled(uid,true);
  assert.equal((await push.scanPushReminders(time)).queued,2);
  assert.equal((await push.scanPushReminders(time)).queued,0);
  assert.equal((await push.processPushQueue(time)).sent,2);assert.equal(calls.length,2);
  for(const message of calls){assert.ok('fid' in message);assert.equal(message.notification?.title,'事项标题');assert.ok(!JSON.stringify(message).includes('private-'));assert.ok(message.android?.ttl!<=300000);assert.equal(message.data?.accountId,uid);}
  const ids=conn.queryAll<{device_id:string}>('SELECT device_id FROM android_push_deliveries');assert.deepEqual(new Set(ids.map(x=>x.device_id)),new Set([a.id,b.id]));
  schedules.updateSchedule(id,{is_completed:true});
});
test('partial device failure retries independently and records only safe error codes',async()=>{
  reset();const time=now(),id='android-partial';makeSchedule(id,time.toISOString());push.setPushEnabled(uid,true);
  push.registerDevice(uid,deviceInput());push.registerDevice(uid,deviceInput('b'.repeat(22)));
  push.setPushSender(async message=>{if('fid' in message&&message.fid==='b'.repeat(22))throw Object.assign(new Error('sensitive payload'),{code:'messaging/server-unavailable'});calls.push(message);return 'accepted';});
  await push.scanPushReminders(time);assert.deepEqual(await push.processPushQueue(time),{sent:1,failed:1});
  const failed=conn.queryOne<any>("SELECT * FROM android_push_deliveries WHERE status='failed'")!;assert.equal(failed.error,'messaging/server-unavailable');
  push.setPushSender(async message=>{calls.push(message);return 'accepted-after-retry';});
  await push.processPushQueue(new Date(time.getTime()+16000));assert.equal(delivery(failed.id).status,'sent');assert.equal(delivery(failed.id).attempts,2);assert.equal(calls.length,2);
  schedules.updateSchedule(id,{is_completed:true});
});
test('completed, rescheduled, disabled, permission-revoked and expired reminders are suppressed before send',async()=>{
  for(const change of ['completed','rescheduled','disabled','permission','expired','auth']){
    reset();const time=now(),id='android-stale-'+change;makeSchedule(id,time.toISOString());push.setPushEnabled(uid,true);
    const input=deviceInput();push.registerDevice(uid,input);await push.scanPushReminders(time);
    const d=conn.queryOne<any>('SELECT * FROM android_push_deliveries')!;
    if(change==='completed')schedules.updateSchedule(id,{is_completed:true});
    if(change==='rescheduled')schedules.updateSchedule(id,{start_time:new Date(time.getTime()+3600000).toISOString(),end_time:new Date(time.getTime()+3600000).toISOString()});
    if(change==='disabled')push.setPushEnabled(uid,false);
    if(change==='permission')push.registerDevice(uid,{...input,permission:false});
    if(change==='auth')conn.run('UPDATE users SET auth_version=auth_version+1 WHERE id=?',[uid]);
    await push.processPushQueue(change==='expired'?new Date(time.getTime()+300001):time);
    assert.equal(calls.length,0,change);assert.equal(delivery(d.id).status,'suppressed',change);
    schedules.updateSchedule(id,{is_completed:true});
  }
});
test('quiet hours suppress mobile scan instead of delivering stale notifications later',async()=>{
  reset();const t=now(),id='android-quiet';makeSchedule(id,t.toISOString());push.setPushEnabled(uid,true);push.registerDevice(uid,deviceInput());
  conn.run("INSERT INTO reminders (id,user_id,enabled,hour,minute,quiet_hours_enabled,quiet_start,quiet_end,timezone,created_at,updated_at) VALUES (?,?,0,8,0,1,'00:00','23:59','UTC',?,?)",[randomUUID(),uid,stamp,stamp]);
  assert.equal((await push.scanPushReminders(t)).queued,0);conn.run('DELETE FROM reminders WHERE user_id=?',[uid]);schedules.updateSchedule(id,{is_completed:true});
});
test('periodic task candidate is pushed without waiting for AI or enabling in-app',async()=>{
  reset();const time=now(),date=time.toISOString().slice(0,10),clock=time.toISOString().slice(11,16);
  const task=reminders.createReminderTask({userId:uid,type:'generic',name:'周期事务',timezone:'UTC',config:{templateKey:'custom',rule:{frequency:'once',anchorDate:date,advancePolicy:'calendar'},reminderOffsets:[0],reminderTime:clock,actionGuide:'private-guide',priority:'medium'}});
  push.registerDevice(uid,deviceInput());push.setPushEnabled(uid,true);
  await push.scanPushReminders(time);await push.processPushQueue(time);
  const d=conn.queryOne<any>("SELECT * FROM android_push_deliveries WHERE kind='reminder'")!;
  assert.ok(d.target_path.startsWith('/reminders?task='+task.id));assert.ok(!JSON.stringify(calls).includes('private-guide'));assert.equal(calls.length,1);
  reminders.updateReminderTask(task.id,uid,{enabled:false});
});
test('legacy consumer never claims Push, and ordinary exports omit device identities',async()=>{
  reset();const item=activity.enqueueNotification({userId:uid,sourceType:'schedule',sourceId:'dummy',channel:'push',kind:'due',title:'x',body:'x',scheduledAt:stamp,dedupeKey:randomUUID()});
  const notification=await import('./notification-service.js');await notification.processNotificationQueue();assert.equal(activity.getNotification(item.id)?.status,'pending');
  const input=deviceInput();push.registerDevice(uid,input);assert.ok(!JSON.stringify(db.exportUserAccountData(uid)).includes(input.fid!));
  db.clearUserData(uid);assert.equal(push.publicDevices(uid).length,0);assert.equal(push.pushEnabled(uid),false);
});
test('HTTP endpoints require auth and ownership, never return raw registration credentials',async()=>{
  reset();const {createAuth}=await import('./auth.js'),{createAndroidPushRouter}=await import('./routes/android-push.js');
  const auth=createAuth({secret:'synthetic-android-test',getUserById:db.getUserById});
  const app=express();app.use(express.json());app.use(createAndroidPushRouter(auth));const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
  const port=(server.address() as {port:number}).port,base=`http://127.0.0.1:${port}`;
  const header=(id:string)=>({Authorization:'Bearer '+auth.signUserToken(db.getUserById(id)!),'Content-Type':'application/json'});
  try{
    assert.equal((await fetch(base+'/api/android-push')).status,401);
    const input=deviceInput(),d=push.registerDevice(uid,input);
    const listed=await (await fetch(base+'/api/android-push',{headers:header(uid)})).text();assert.ok(!listed.includes(input.fid!));assert.ok(!listed.includes(input.installationKey));
    assert.equal((await fetch(base+`/api/android-push/devices/${d.id}`,{method:'DELETE',headers:header(other)})).status,404);
    const testNotice=push.queuePushTest(uid,d.id);assert.equal(push.publicDevices(uid)[0].lastTest?.id,testNotice.id);assert.equal((await fetch(base+`/api/android-push/notifications/${testNotice.id}`,{headers:header(other)})).status,404);
    assert.equal((await fetch(base+`/api/android-push/notifications/${testNotice.id}`,{headers:header(uid)})).status,200);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('system backup copy strips mobile credentials without changing live bindings',()=>{
  reset();const input=deviceInput();push.registerDevice(uid,input);push.setPushEnabled(uid,true);
  const original=db.exportChatDb(),cleaned=conn.sanitizeAndroidPushBackup(original);
  assert.ok(!cleaned.includes(Buffer.from(input.fid!)));assert.ok(!cleaned.includes(Buffer.from(input.installationId)));
  assert.equal(push.publicDevices(uid).length,1);assert.equal(push.pushEnabled(uid),true);assert.ok(db.exportChatDb().includes(Buffer.from(input.fid!)));
});
test('cleared mobile records do not leak FIDs through SQLite free space in later snapshots',()=>{
  reset();const input=deviceInput('d'.repeat(22));push.registerDevice(uid,input);
  for(const table of ['android_push_devices','android_push_preferences','android_push_deliveries'])conn.run(`DELETE FROM ${table} WHERE user_id=?`,[uid]);
  const bytes=db.exportChatDb();assert.ok(!bytes.includes(Buffer.from(input.fid!)));assert.ok(!conn.sanitizeAndroidPushBackup(bytes).includes(Buffer.from(input.fid!)));
});
test('invalid FCM installation revokes only that device and pending deliveries survive restart',async()=>{
  reset();const time=now(),id='android-invalid';makeSchedule(id,time.toISOString());push.setPushEnabled(uid,true);
  push.registerDevice(uid,deviceInput());push.registerDevice(uid,deviceInput('b'.repeat(22)));
  await push.scanPushReminders(time);await db.initDb();
  push.setPushSender(async message=>{if('fid' in message&&message.fid==='a'.repeat(22))throw Object.assign(new Error('private identifier'),{code:'messaging/registration-token-not-registered'});return 'accepted';});
  assert.deepEqual(await push.processPushQueue(time),{sent:1,failed:1});assert.equal(push.publicDevices(uid).length,1);
  await push.processPushQueue(new Date(time.getTime()+16000));
  assert.equal(conn.queryOne<any>("SELECT * FROM android_push_deliveries WHERE error='binding_invalid'")?.status,'suppressed');schedules.updateSchedule(id,{is_completed:true});
});
test('FID rotation retargets unsent delivery but never repeats a previously accepted reminder',async()=>{
  reset();const time=now(),id='android-rotate';makeSchedule(id,time.toISOString());push.setPushEnabled(uid,true);
  const input=deviceInput();push.registerDevice(uid,input);await push.scanPushReminders(time);
  const rotated=push.registerDevice(uid,{...input,fid:'b'.repeat(22)});
  assert.equal((await push.scanPushReminders(time)).queued,1);
  const d=conn.queryOne<any>('SELECT * FROM android_push_deliveries')!;assert.equal(d.generation,rotated.generation);
  await push.processPushQueue(time);assert.equal(calls.length,1);assert.ok('fid' in calls[0]&&calls[0].fid==='b'.repeat(22));
  push.registerDevice(uid,{...input,fid:'c'.repeat(22)});assert.equal((await push.scanPushReminders(time)).queued,0);await push.processPushQueue(time);assert.equal(calls.length,1);
  schedules.updateSchedule(id,{is_completed:true});
});
