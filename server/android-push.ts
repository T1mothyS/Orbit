import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Message } from 'firebase-admin/messaging';
import { queryAll, queryOne, run } from './database/connection.js';
import * as db from './db.js';
import { withPersistenceTransaction } from './persistence.js';
import { proactiveCandidates } from './orbit-proactive.js';
import { quietAdjustedDate } from './notification-service.js';
import { readReminderProjectionSources } from './reminder-store.js';
import { syncReminderTaskToCalendar } from './reminder-calendar-sync.js';
import { createJobRunner } from './runtime/job-runner.js';
import { addLog } from './log-service.js';

interface Device {
  id:string; installation_id:string; user_id:string; key_hash:string; fid:string|null;
  generation:string; auth_version:number; permission:number; label:string; version:string;
  revoked:number; created_at:string; updated_at:string;
}
export interface PushDelivery {
  id:string; user_id:string; device_id:string; generation:string; schedule_id:string|null;
  expected_state:string|null; trigger_at:string; expires_at:string; kind:string;
  title:string; body:string; target_path:string; status:string; attempts:number;
  next_retry_at:string|null; error:string|null; receipt:string|null; created_at:string; sent_at:string|null;
}
export class PushInputError extends Error { constructor(message:string,public status=400){super(message);} }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (key:string) => createHash('sha256').update(key).digest('hex');
const sameKey = (key:string,stored:string) => typeof key==='string' && /^[0-9a-f]{64}$/.test(stored) && timingSafeEqual(Buffer.from(hash(key),'hex'),Buffer.from(stored,'hex'));
export const pushConfigured = () => !!process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
export const pushEnabled = (userId:string) => queryOne<{enabled:number}>('SELECT enabled FROM android_push_preferences WHERE user_id=?',[userId])?.enabled===1;
export function setPushEnabled(userId:string,enabled:boolean) {
  withPersistenceTransaction(()=>{
    run('INSERT INTO android_push_preferences (user_id,enabled) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled',[userId,enabled?1:0]);
    if(!enabled)run("UPDATE android_push_deliveries SET status='suppressed',error='push_disabled' WHERE user_id=? AND status IN ('pending','failed') AND kind<>'test'",[userId]);
  });
}
export function publicDevices(userId:string) {
  return queryAll<Device>('SELECT * FROM android_push_devices WHERE user_id=? AND revoked=0',[userId]).map(d=>{
    const test=queryOne<PushDelivery>("SELECT * FROM android_push_deliveries WHERE device_id=? AND user_id=? AND generation=? AND kind='test' ORDER BY created_at DESC LIMIT 1",[d.id,userId,d.generation]);
    return {id:d.id,label:d.label,version:d.version,permission:!!d.permission,registered:!!d.fid,updatedAt:d.updated_at,lastTest:test?{id:test.id,status:test.status,error:test.error,createdAt:test.created_at,sentAt:test.sent_at}:null};
  });
}
export function registerDevice(userId:string,input:{installationId:string;installationKey:string;fid?:string|null;permission:boolean;label:string;version:string}) {
  if(!uuid.test(input.installationId)||!/^[-\w]{32,128}$/.test(input.installationKey)||typeof input.permission!=='boolean'||typeof input.label!=='string'||input.label.length>80||typeof input.version!=='string'||input.version.length>80||input.fid!=null&&!/^[A-Za-z0-9_-]{22}$/.test(input.fid))throw new PushInputError('设备注册格式不正确');
  const user=db.getUserById(userId);if(!user||user.disabled)throw new PushInputError('账号不可用',403);
  return withPersistenceTransaction(()=>{
    const old=queryOne<Device>('SELECT * FROM android_push_devices WHERE installation_id=?',[input.installationId]);
    if(old&&!sameKey(input.installationKey,old.key_hash))throw new PushInputError('设备身份不匹配',403);
    // A known installation capability permits a physical account switch; another account cannot steal a binding by ID.
    const other=input.fid?queryOne<Device>('SELECT * FROM android_push_devices WHERE fid=?',[input.fid]):undefined;
    if(other&&other.id!==old?.id)throw new PushInputError('注册身份已绑定其他设备',409);
    const changed=!old||!!old.revoked||old.user_id!==userId||old.fid!==(input.fid||null)||old.auth_version!==(user.auth_version??0);
    const id=old?.id||randomUUID(),generation=changed?randomUUID():old!.generation,now=new Date().toISOString();
    if(changed&&old)run("UPDATE android_push_deliveries SET status='suppressed',error='binding_changed' WHERE device_id=? AND status IN ('pending','failed')",[id]);
    run(`INSERT INTO android_push_devices (id,installation_id,user_id,key_hash,fid,generation,auth_version,permission,label,version,revoked,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?) ON CONFLICT(installation_id) DO UPDATE SET user_id=excluded.user_id,fid=excluded.fid,generation=excluded.generation,auth_version=excluded.auth_version,permission=excluded.permission,label=excluded.label,version=excluded.version,revoked=0,updated_at=excluded.updated_at`,
      [id,input.installationId,userId,hash(input.installationKey),input.fid||null,generation,user.auth_version??0,input.permission?1:0,input.label,input.version,now,now]);
    return {id,generation,registered:!!input.fid};
  });
}
export function revokeDevice(userId:string,id:string) {
  const device=queryOne<Device>('SELECT * FROM android_push_devices WHERE id=? AND user_id=?',[id,userId]);
  if(!device)throw new PushInputError('设备不存在',404);
  revoke(device);
}
function revoke(device:Device) {
  withPersistenceTransaction(()=>{
    run('UPDATE android_push_devices SET revoked=1,fid=NULL,generation=?,updated_at=? WHERE id=?',[randomUUID(),new Date().toISOString(),device.id]);
    run("UPDATE android_push_deliveries SET status='suppressed',error='device_revoked' WHERE device_id=? AND status IN ('pending','failed')",[device.id]);
  });
}
// A revoke-only capability allows offline logout compensation without retaining a login bearer token.
export function revokeByCapability(id:string,generation:string,key:string) {
  const device=queryOne<Device>('SELECT * FROM android_push_devices WHERE id=?',[id]);
  if(!device||device.revoked||device.generation!==generation)return;
  if(!sameKey(key,device.key_hash))throw new PushInputError('解绑凭据无效',403);
  revoke(device);
}
function enqueue(device:Device,input:Pick<PushDelivery,'schedule_id'|'expected_state'|'trigger_at'|'expires_at'|'kind'|'title'|'body'|'target_path'>,key:string) {
  const old=queryOne<PushDelivery>('SELECT * FROM android_push_deliveries WHERE dedupe_key=?',[key]);if(old)return old;
  const id=randomUUID();
  run(`INSERT INTO android_push_deliveries (id,user_id,device_id,generation,schedule_id,expected_state,trigger_at,expires_at,kind,title,body,target_path,created_at,dedupe_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[id,device.user_id,device.id,device.generation,input.schedule_id,input.expected_state,input.trigger_at,input.expires_at,input.kind,input.title.slice(0,180),input.body.slice(0,180),input.target_path,new Date().toISOString(),key]);
  return queryOne<PushDelivery>('SELECT * FROM android_push_deliveries WHERE id=?',[id])!;
}
export function queuePushTest(userId:string,id:string,now=new Date()) {
  const device=queryOne<Device>('SELECT * FROM android_push_devices WHERE id=? AND user_id=? AND revoked=0',[id,userId]);
  if(!device)throw new PushInputError('设备不存在',404);
  if(!device.permission||!device.fid)throw new PushInputError('请先授权通知并完成 FCM 注册');
  if(!pushConfigured()&&sender===firebaseSender)throw new PushInputError('服务端 FCM 尚未配置',503);
  const recent=queryOne('SELECT id FROM android_push_deliveries WHERE device_id=? AND kind=\'test\' AND created_at>?',[id,new Date(now.getTime()-30000).toISOString()]);
  if(recent)throw new PushInputError('请间隔至少 30 秒再次测试',429);
  return enqueue(device,{schedule_id:null,expected_state:null,trigger_at:now.toISOString(),expires_at:new Date(now.getTime()+300000).toISOString(),kind:'test',title:'Orbit FCM 测试',body:now.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),target_path:'/today'},`test:${randomUUID()}`);
}
export function pushResult(userId:string,id:string) {
  const d=queryOne<PushDelivery>('SELECT * FROM android_push_deliveries WHERE id=? AND user_id=?',[id,userId]);
  if(!d)throw new PushInputError('通知不存在',404);
  return {id:d.id,status:d.status,attempts:d.attempts,error:d.error,sentAt:d.sent_at,receipt:d.receipt,targetPath:d.target_path};
}
export async function scanPushReminders(now=new Date()) {
  let queued=0;
  const users=queryAll<{id:string}>(`SELECT u.id FROM users u JOIN android_push_preferences p ON p.user_id=u.id WHERE u.disabled=0 AND p.enabled=1`);
  for(const {id:userId} of users){
    if(quietAdjustedDate(userId,now.toISOString())>now.toISOString())continue;
    for(const p of readReminderProjectionSources(userId).filter(p=>p.current&&p.cycle))syncReminderTaskToCalendar({...p.task,currentCycle:p.cycle,nextReminderDate:null,lastReminderDate:null,sentReminderTypes:[]});
    const devices=queryAll<Device>('SELECT * FROM android_push_devices WHERE user_id=? AND revoked=0 AND permission=1 AND fid IS NOT NULL',[userId]);
    for(const c of proactiveCandidates(userId)) {
      const trigger=Date.parse(c.trigger),age=now.getTime()-trigger;
      if(age<0||age>300000||(!c.taskId&&trigger<c.start.getTime()&&c.start.getTime()<now.getTime()))continue;
      for(const device of devices){
        if(device.auth_version!==(db.getUserById(userId)?.auth_version??0))continue;
        // A rotating FID is still the same physical device. Never resend an accepted reminder after rotation.
        const key=`push:${userId}:${device.id}:${c.schedule.id}:${c.trigger}`;
        const old=queryOne<PushDelivery>('SELECT * FROM android_push_deliveries WHERE dedupe_key=?',[key]);
        if(old&&(old.status==='sent'||old.status==='sending'||(old.generation===device.generation&&(old.expected_state===c.expected||!['pending','failed'].includes(old.status)))))continue;
        const body=c.start.toLocaleString('zh-CN',{timeZone:db.getReminder(userId)?.timezone||'Asia/Shanghai',hour12:false});
        const target=c.taskId?`/reminders?task=${encodeURIComponent(c.taskId)}&cycle=${encodeURIComponent(c.instanceId!)}`:`/schedule?schedule=${encodeURIComponent(c.schedule.id)}&date=${c.schedule.start_time.slice(0,10)}`;
        if(old)run("UPDATE android_push_deliveries SET generation=?,expected_state=?,title=?,body=?,target_path=?,status='pending',attempts=?,next_retry_at=NULL,error=NULL WHERE id=?",[device.generation,c.expected,c.schedule.title.slice(0,180),body,target,old.generation===device.generation?old.attempts:0,old.id]);
        else enqueue(device,{schedule_id:c.schedule.id,expected_state:c.expected,trigger_at:c.trigger,expires_at:new Date(trigger+300000).toISOString(),kind:'reminder',title:c.schedule.title,body,target_path:target},key);
        queued++;
      }
    }
  }
  return {queued};
}
export type PushSender = (message:Message)=>Promise<string>;
const firebaseSender:PushSender=async message=>{
  const file=process.env.FIREBASE_SERVICE_ACCOUNT_FILE;if(!file)throw Object.assign(new Error('configuration_missing'),{code:'configuration_missing'});
  let app=getApps().find(a=>a.name==='orbit-android');
  if(!app){try{app=initializeApp({credential:cert(JSON.parse(fs.readFileSync(file,'utf8')))},'orbit-android');}catch{throw Object.assign(new Error('configuration_invalid'),{code:'configuration_invalid'});}}
  return getMessaging(app).send(message);
};
let sender:PushSender=firebaseSender;
export function setPushSender(next:PushSender){const old=sender;sender=next;return old;}
let processing=false;
export async function processPushQueue(now=new Date(),onlyId?:string) {
  if(processing)return {sent:0,failed:0};processing=true;let sent=0,failed=0;
  try{
    const rows=queryAll<PushDelivery>(`SELECT * FROM android_push_deliveries WHERE status IN ('pending','failed') AND attempts<4 AND trigger_at<=? AND (next_retry_at IS NULL OR next_retry_at<=?) ${onlyId?'AND id=?':''} ORDER BY created_at LIMIT 100`,[now.toISOString(),now.toISOString(),...(onlyId?[onlyId]:[])]);
    for(const d of rows){
      const device=queryOne<Device>('SELECT * FROM android_push_devices WHERE id=?',[d.device_id]),user=db.getUserById(d.user_id);
      let reason='';
      if(!device||device.revoked||device.user_id!==d.user_id||device.generation!==d.generation||!device.fid||!device.permission||!user||user.disabled||device.auth_version!==(user.auth_version??0))reason='binding_invalid';
      else if(Date.parse(d.expires_at)<now.getTime())reason='expired';
      else if(d.kind!=='test'){
        const c=proactiveCandidates(d.user_id).find(c=>c.schedule.id===d.schedule_id&&c.trigger===d.trigger_at&&c.expected===d.expected_state);
        if(!pushEnabled(d.user_id)||!c||(!c.taskId&&Date.parse(c.trigger)<c.start.getTime()&&c.start.getTime()<now.getTime()))reason='reminder_changed';
        else if(quietAdjustedDate(d.user_id,now.toISOString())>now.toISOString())reason='quiet_hours';
      }
      if(reason){run("UPDATE android_push_deliveries SET status='suppressed',error=? WHERE id=?",[reason,d.id]);continue;}
      if(!run("UPDATE android_push_deliveries SET status='sending',attempts=attempts+1 WHERE id=? AND status IN ('pending','failed')",[d.id]).changes)continue;
      try{
        const receipt=await sender({fid:device!.fid!,notification:{title:d.title,body:d.body},data:{notificationId:d.id,accountId:d.user_id,generation:d.generation},android:{priority:'high',ttl:Math.max(0,Date.parse(d.expires_at)-now.getTime()),notification:{channelId:'orbit_reminders',tag:d.kind==='test'?`fcm-test:${device!.id}`:`reminder:${d.id}`,clickAction:'io.github.t1mothys.orbit.OPEN_NOTIFICATION',sound:'default'}}});
        run("UPDATE android_push_deliveries SET status='sent',sent_at=?,receipt=?,error=NULL,next_retry_at=NULL WHERE id=?",[new Date().toISOString(),receipt,d.id]);sent++;
      }catch(error){
        // Provider error text can contain identifiers. Persist only allowlisted error codes.
        const raw=String((error as {code?:string})?.code||'');
        const code=/^(messaging\/[a-z-]+|app\/[a-z-]+|configuration_(missing|invalid))$/.test(raw)?raw:'transport_failure';
        if(['messaging/registration-token-not-registered','messaging/invalid-registration-token','messaging/installation-not-found'].includes(code))revoke(device!);
        const delay=[15000,30000,60000,120000][Math.min(d.attempts,3)];
        run("UPDATE android_push_deliveries SET status='failed',error=?,next_retry_at=? WHERE id=?",[code,new Date(now.getTime()+delay).toISOString(),d.id]);failed++;
      }
    }
  }finally{processing=false;}
  return {sent,failed};
}
export function createAndroidPushJobs(isReady:()=>boolean){let ticking=false;return createJobRunner([{name:'android-push',expression:'*/15 * * * * *',run:async()=>{if(!isReady()||ticking||!pushConfigured())return;ticking=true;try{await scanPushReminders();await processPushQueue();}finally{ticking=false;}}}],()=>addLog('error','system','Android Push 扫描失败',{event:'android_push_tick_failed'}));}
