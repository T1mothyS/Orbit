import { randomUUID } from 'node:crypto';
import { queryAll, queryOne, run } from './database/connection.js';
import { getLibraryEntry, getReminder } from './db.js';
import { getAllSchedules } from './schedule-store.js';
import { readReminderProjectionSources } from './reminder-store.js';
import { listCompletions, listDailyReportStatistics } from './activity-store.js';
import { dateInZone, statisticsPeriod, addDateDays } from './orbit-time.js';
import { parseScheduleStart } from './notification-scheduler.js';

export function recordKnowledgeRead(userId:string, entryId:string, now=new Date()) {
  if(!getLibraryEntry(entryId,userId)) throw new Error('知识条目不存在');
  // Rolling half hour: crossing a clock bucket boundary does not turn a reload into a second read.
  const last=queryOne<{created_at:string}>('SELECT created_at FROM orbit_knowledge_events WHERE user_id=? AND entry_id=? AND kind=? ORDER BY created_at DESC LIMIT 1',[userId,entryId,'read']);
  if(last&&Date.parse(last.created_at)>now.getTime()-1800000)return;
  const id=`read:${entryId}:${randomUUID()}`;
  run('INSERT OR IGNORE INTO orbit_knowledge_events (id,user_id,entry_id,kind,created_at) VALUES (?,?,?,?,?)',[`${userId}:${id}`,userId,entryId,'read',now.toISOString()]);
}
export function recordKnowledgeCitations(userId:string,messageId:string,sources:unknown,now=new Date()) {
  if(!Array.isArray(sources))return;
  for(const source of sources)if(source.referenced===true && getLibraryEntry(source.id,userId))
    run('INSERT OR IGNORE INTO orbit_knowledge_events (id,user_id,entry_id,kind,created_at) VALUES (?,?,?,?,?)',[`${userId}:citation:${messageId}:${source.id}`,userId,source.id,'citation',now.toISOString()]);
}
export function getOrbitStatistics(userId:string,period='week',anchor?:string,now=new Date(),filters:{taskType?:string;reportSource?:string}={}) {
  if(filters.taskType&&!['all','event','todo','reminder'].includes(filters.taskType))throw new Error('事项筛选无效');
  if(filters.reportSource&&!['all','local','cloud'].includes(filters.reportSource))throw new Error('日报来源筛选无效');
  const timezone=getReminder(userId)?.timezone||'Asia/Shanghai';
  const today=dateInZone(now,timezone), window={...statisticsPeriod(period,anchor||today),period,anchor:anchor||today,timezone,asOf:now.toISOString()};
  const inPeriod=(day:string)=>day>=window.start&&day<=window.end;
  const dayCache=new Map<string,string>();
  const localDay=(value:string)=> {const cached=dayCache.get(value);if(cached)return cached;const parsed=parseScheduleStart(value,timezone);const result=parsed?dateInZone(parsed,timezone):value.slice(0,10);dayCache.set(value,result);return result;};
  const details:Array<{id:string;title:string;date:string;completed:boolean;kind:string;href:string}>=[];
  const schedules=getAllSchedules(userId).filter(s=>!s.id.startsWith('reminder-cycle:')&&(!filters.taskType||filters.taskType==='all'||filters.taskType===s.type));
  for(const s of schedules)if(!s.is_unscheduled&&inPeriod(s.all_day?s.start_time.slice(0,10):localDay(s.start_time)))details.push({id:s.id,title:s.title,date:s.all_day?s.start_time.slice(0,10):localDay(s.start_time),completed:!!s.is_completed,kind:'schedule',href:`/schedule?date=${s.start_time.slice(0,10)}`});
  for(const {task,cycle} of readReminderProjectionSources(userId))if((!filters.taskType||['all','reminder'].includes(filters.taskType))&&cycle && !['cancelled'].includes(cycle.status)&&inPeriod(cycle.plannedDate||cycle.dueDate))details.push({id:cycle.id,title:task.name,date:cycle.plannedDate||cycle.dueDate,completed:cycle.status==='completed',kind:'reminder',href:'/reminders'});
  const allCompletions=listCompletions(userId);
  const completions=allCompletions.filter(c=>!c.reopenedAt&&inPeriod(localDay(c.completedAt))&&(!filters.taskType||filters.taskType==='all'||(filters.taskType==='reminder'?c.sourceType==='reminder':schedules.some(s=>s.id===c.sourceId))));
  const actualCompleted=new Set(completions.map(c=>`${c.sourceType}:${c.instanceId||c.sourceId}`)).size;
  const completed=details.filter(d=>d.completed).length;
  const unknownCompletedAt=schedules.filter(s=>s.is_completed&&!s.is_unscheduled&&inPeriod(localDay(s.start_time))&&!allCompletions.some(c=>c.sourceType==='schedule'&&c.sourceId===s.id&&!c.reopenedAt)).length;
  const reports=listDailyReportStatistics(userId).filter(r=>inPeriod(r.reportDate)&&(!filters.reportSource||filters.reportSource==='all'||r.source===filters.reportSource));
  const received=reports.filter(r=>r.deliveryStatus==='received').filter((r,i,rows)=>rows.findIndex(v=>v.reportDate===r.reportDate&&v.source===r.source)===i);
  const reportKeys=new Set(received.map(r=>`${r.reportDate}:${r.source}`));
  const entries=queryAll<any>('SELECT id,title,kind,status,created_at,updated_at FROM library_entries WHERE user_id=?',[userId]);
  const updates=queryAll<any>(`SELECT v.entry_id,v.created_at FROM library_entry_versions v WHERE v.user_id=? AND v.content_hash <> (SELECT p.content_hash FROM library_entry_versions p WHERE p.user_id=v.user_id AND p.entry_id=v.entry_id AND (p.created_at<v.created_at OR (p.created_at=v.created_at AND p.rowid<v.rowid)) ORDER BY p.created_at DESC,p.rowid DESC LIMIT 1)`,[userId]).filter(v=>inPeriod(localDay(v.created_at)));
  const events=queryAll<any>('SELECT entry_id,kind,created_at FROM orbit_knowledge_events WHERE user_id=?',[userId]).filter(e=>inPeriod(localDay(e.created_at)));
  const trackingSince=queryOne<{value:string}>('SELECT value FROM orbit_metrics_meta WHERE key=?',['knowledge_tracking_since'])?.value||now.toISOString();
  const reads=events.filter(e=>e.kind==='read'),citations=events.filter(e=>e.kind==='citation');
  const trend:Array<{date:string;tasks:number;completed:number;reports:number;reads:number;citations:number}>=[];
  for(let d=window.start;d<=window.end;d=addDateDays(d,1)) {
    const key=period==='year'?d.slice(0,7):d;
    let bucket=trend.find(b=>b.date===key);if(!bucket){bucket={date:key,tasks:0,completed:0,reports:0,reads:0,citations:0};trend.push(bucket);}
    bucket.tasks+=details.filter(i=>i.date===d).length;
    bucket.completed+=new Set(completions.filter(c=>localDay(c.completedAt)===d).map(c=>`${c.sourceType}:${c.instanceId||c.sourceId}`)).size;
    bucket.reports+=new Set(received.filter(r=>r.reportDate===d).map(r=>`${r.reportDate}:${r.source}`)).size;
    bucket.reads+=reads.filter(e=>localDay(e.created_at)===d).length;bucket.citations+=citations.filter(e=>localDay(e.created_at)===d).length;
  }
  return {window,trackingSince,historyTracked:window.end>=localDay(trackingSince),tasks:{total:details.length,completed,pending:details.length-completed,notStarted:details.filter(d=>!d.completed&&d.date>=today).length,overdue:details.filter(d=>!d.completed&&d.date<today).length,rate:details.length?Math.round(completed/details.length*100):null,actualCompleted,unknownCompletedAt,unscheduled:schedules.filter(s=>s.is_unscheduled&&!s.is_completed).length},reports:{total:reportKeys.size,days:new Set(received.map(r=>r.reportDate)).size,local:[...reportKeys].filter(k=>k.endsWith(':local')).length,cloud:[...reportKeys].filter(k=>k.endsWith(':cloud')).length,candidates:reports.filter(r=>r.deliveryStatus==='candidate').length},knowledge:{active:entries.filter(e=>e.status==='active').length,articles:entries.filter(e=>e.status==='active'&&e.kind==='article').length,fragments:entries.filter(e=>e.status==='active'&&e.kind==='fragment').length,archived:entries.filter(e=>e.status==='archived').length,added:entries.filter(e=>inPeriod(localDay(e.created_at))).length,updates:updates.length,reads:reads.length,readDays:new Set(reads.map(e=>localDay(e.created_at))).size,citations:citations.length,historyNote:'阅读与 AI 引用从本功能启用后采集，历史未采集不代表零使用。'},trend,details,reportDetails:received,knowledgeDetails:entries.map(e=>({id:e.id,title:e.title,status:e.status,href:`/library/${e.id}`}))};
}
