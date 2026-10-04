import { randomUUID } from 'node:crypto';
import { queryAll, queryOne, run } from './database/connection.js';
import { getReminder, getUserById, upsertReminder } from './db.js';
import { getSchedule } from './schedule-store.js';
import { readReminderProjectionSources } from './reminder-store.js';
import { ensureDefaultConversation } from './orbit-store.js';
import { withPersistenceTransaction } from './persistence.js';
import { scheduleFingerprint } from './ai-plan.js';
import { orbitObjectPath, type OrbitObject } from '../src/utils/orbit-links.js';
import * as activity from './activity-store.js';
import { quietAdjustedDate } from './notification-service.js';

export function inAppEnabled(userId:string) {return getReminder(userId)?.in_app_enabled === 1;}
export function setInAppEnabled(userId:string,enabled:boolean) {
  const current=getReminder(userId);
  // The notifications preference is the single source of truth, including legacy API callers.
  run('UPDATE orbit_preferences SET proactive_enabled=0 WHERE user_id=?',[userId]);
  const now=new Date().toISOString();
  return upsertReminder({...current,id:current?.id||randomUUID(),user_id:userId,enabled:current?.enabled??0,hour:current?.hour??8,minute:current?.minute??0,in_app_enabled:enabled?1:0,created_at:current?.created_at||now,updated_at:now});
}
export function notificationObject(item:activity.NotificationDelivery):OrbitObject|undefined {
  if(item.sourceType==='schedule') {const s=getSchedule(item.sourceId);if(s?.user_id===item.userId)return {type:'schedule',id:s.id,date:s.start_time.slice(0,10)};}
  if(item.sourceType==='reminder') {const p=readReminderProjectionSources(item.userId).find(p=>p.task.id===item.sourceId&&(!item.instanceId||p.cycle?.id===item.instanceId));if(p)return {type:'reminder',id:p.task.id,instanceId:item.instanceId||undefined};}
  if(item.sourceType==='activity_report'&&queryOne('SELECT id FROM orbit_activity_reports WHERE id=? AND user_id=?',[item.sourceId,item.userId]))return {type:'activity-report',id:item.sourceId};
  return undefined;
}
export function deliverInApp(item:activity.NotificationDelivery,eventId?:string,enhanced=false):string|undefined {
  if(!inAppEnabled(item.userId)||getUserById(item.userId)?.disabled)return;
  const ref=notificationObject(item);
  if(['schedule','reminder','activity_report'].includes(item.sourceType)&&!ref)return;
  if(ref?.type==='schedule'&&getSchedule(ref.id)?.is_completed)return;
  if(ref?.type==='reminder'){const p=readReminderProjectionSources(item.userId).find(p=>p.task.id===ref.id&&p.cycle?.id===ref.instanceId);if(!p?.task.enabled||!p.current||!p.cycle||!['pending','expired'].includes(p.cycle.status))return;}
  if(item.sourceType==='digest'&&getReminder(item.userId)?.enabled!==1)return;
  const deliveryKey=`${item.sourceType}:${item.sourceId}:${item.instanceId||''}:${new Date(item.scheduledAt).toISOString()}`;
  return withPersistenceTransaction(()=>{
    const previous=queryOne<{message_id:string}>('SELECT message_id FROM orbit_notification_messages WHERE user_id=? AND (notification_id=? OR delivery_key=?)',[item.userId,item.id,deliveryKey]);
    if(previous){
      if(eventId){const row=queryOne<{orbit_meta:string}>('SELECT orbit_meta FROM ai_schedule_messages WHERE id=? AND user_id=?',[previous.message_id,item.userId]);if(row)run('UPDATE ai_schedule_messages SET orbit_meta=? WHERE id=? AND user_id=?',[JSON.stringify({...JSON.parse(row.orbit_meta),eventId,enhanced}),previous.message_id,item.userId]);}
      activity.markNotificationSent(item.id);return previous.message_id;
    }
    const cid=ensureDefaultConversation(item.userId),id=randomUUID(),at=new Date().toISOString();
    const schedule=ref?.type==='schedule'?getSchedule(ref.id):undefined;
    const linkedSchedule=schedule||(ref?.type==='reminder'&&ref.instanceId?getSchedule(`reminder-cycle:${ref.instanceId}`):undefined);
    const meta={sourceLabel:({schedule:'日程',reminder:'周期提醒',activity_report:'个人周报',digest:'每日行动提醒'} as Record<string,string>)[item.sourceType]||'用户通知',origin:'notification',notificationId:item.id,eventId,enhanced,object:ref,expectedState:linkedSchedule?scheduleFingerprint(linkedSchedule):undefined,href:item.sourceType==='digest'?'/today':ref?orbitObjectPath(ref):undefined};
    const body=item.kind==='weekly_report'?item.body.slice(0,500):item.body;
    run('INSERT INTO ai_schedule_messages (id,user_id,role,type,content,schedule_items,created_at,conversation_id,orbit_meta) VALUES (?,?,?,?,?,?,?,?,?)',[id,item.userId,'assistant','text',`${item.title}\n\n${body}`,linkedSchedule?JSON.stringify([linkedSchedule]):null,at,cid,JSON.stringify(meta)]);
    run('INSERT INTO orbit_notification_messages (notification_id,user_id,message_id,delivery_key) VALUES (?,?,?,?)',[item.id,item.userId,id,deliveryKey]);
    run('UPDATE orbit_conversations SET updated_at=? WHERE id=? AND user_id=?',[at,cid,item.userId]);
    activity.markNotificationSent(item.id);
    return id;
  });
}
export function notificationView(userId:string,id:string) {
  const item=activity.getNotification(id,userId);if(!item)return {state:'discarded'};
  const ref=notificationObject(item);
  let state='sent';
  if(['schedule','reminder','activity_report'].includes(item.sourceType)&&!ref)state='discarded';
  if(ref?.type==='schedule'&&getSchedule(ref.id)?.is_completed)state='handled';
  if(ref?.type==='reminder'){const p=readReminderProjectionSources(userId).find(p=>p.cycle?.id===item.instanceId);if(p?.cycle?.status==='completed')state='handled';}
  const message=queryOne<{orbit_meta:string}>('SELECT m.orbit_meta FROM orbit_notification_messages n JOIN ai_schedule_messages m ON m.id=n.message_id AND m.user_id=n.user_id WHERE n.user_id=? AND n.notification_id=?',[userId,id]);
  const meta=message?JSON.parse(message.orbit_meta):{};
  const linked=ref?.type==='schedule'?getSchedule(ref.id):ref?.type==='reminder'&&ref.instanceId?getSchedule(`reminder-cycle:${ref.instanceId}`):null;
  if(linked&&meta.expectedState&&scheduleFingerprint(linked)!==meta.expectedState&&state==='sent')state='discarded';
  return {state,readAt:item.readAt,href:item.sourceType==='digest'?'/today':ref?orbitObjectPath(ref):undefined,object:ref,actionable:!!linked&&!!meta.expectedState&&state==='sent'};
}
export function eventForNotification(userId:string,id:string):string {
  const item=activity.getNotification(id,userId),view=notificationView(userId,id);if(!item||!view.actionable)throw new Error('通知已失效或不支持事项操作');
  const message=queryOne<{message_id:string}>('SELECT message_id FROM orbit_notification_messages WHERE notification_id=? AND user_id=?',[id,userId])!;
  const row=queryOne<{orbit_meta:string}>('SELECT orbit_meta FROM ai_schedule_messages WHERE id=? AND user_id=?',[message.message_id,userId])!,meta=JSON.parse(row.orbit_meta);
  if(meta.eventId)return meta.eventId;
  const scheduleId=item.sourceType==='schedule'?item.sourceId:`reminder-cycle:${item.instanceId}`;
  let eventId=`notification:${id}`;
  withPersistenceTransaction(()=>{run('INSERT OR IGNORE INTO orbit_proactive_events (id,user_id,schedule_id,instance_id,expected_state,trigger_at,state,message_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',[eventId,userId,scheduleId,item.instanceId,meta.expectedState,item.scheduledAt,'sent',message.message_id,new Date().toISOString()]);eventId=queryOne<{id:string}>('SELECT id FROM orbit_proactive_events WHERE user_id=? AND schedule_id=? AND trigger_at=?',[userId,scheduleId,item.scheduledAt])!.id;run('UPDATE ai_schedule_messages SET orbit_meta=? WHERE id=? AND user_id=?',[JSON.stringify({...meta,eventId}),message.message_id,userId]);});return eventId;
}
export function processInAppNotifications(now=new Date()) {
  for(const item of activity.listDueNotifications(now.toISOString(),'in_app')){
    const next=quietAdjustedDate(item.userId,now.toISOString());if(next>now.toISOString()){activity.deferNotification(item.id,next);continue;}
    if(!activity.claimNotification(item.id))continue;
    try{if(!deliverInApp(item))activity.suppressNotification(item.id);}catch(e){activity.markNotificationFailed(item.id,e instanceof Error?e.message:'站内投递失败');}
  }
  // The foreground browser channel can become ready without starting SMTP/IMAP jobs.
  for(const item of activity.listDueNotifications(now.toISOString(),'browser')){
    const next=quietAdjustedDate(item.userId,now.toISOString());if(next>now.toISOString()){activity.deferNotification(item.id,next);continue;}
    if(!activity.claimNotification(item.id))continue;
    if(getReminder(item.userId)?.browser_enabled===0||!getUserById(item.userId)||getUserById(item.userId)?.disabled)activity.suppressNotification(item.id);else activity.markNotificationSent(item.id);
  }
}
