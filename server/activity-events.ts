import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
export const activityOrigin=new AsyncLocalStorage<'ai'|'manual'|'import'>();
export interface ActivityEvent { id:string; userId:string; kind:string; sourceId:string; occurredAt:string; metadata:Record<string,unknown> }
let sink: ((event:ActivityEvent)=>void)|undefined;
export function setActivityEventSink(next:(event:ActivityEvent)=>void) {sink=next;}
export function recordActivityEvent(userId:string,kind:string,sourceId:string,metadata:Record<string,unknown>={},key:string=randomUUID(),now=new Date()) {
  sink?.({id:`${userId}:${kind}:${key}`,userId,kind,sourceId,occurredAt:now.toISOString(),metadata});
}
