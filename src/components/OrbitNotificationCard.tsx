import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, MessageCircle } from 'lucide-react';
import { IconButton, IconLink, Tooltip } from '../ui';
import { ReminderActionButtons } from './ReminderActionButtons';
import { useAuth } from '../hooks/useAuth';
import type { NavigationAction } from '../utils/navigation-actions';
export interface NotificationMeta {origin:string;sourceLabel?:string;eventId?:string;notificationId?:string;enhanced?:boolean;state?:string;canContinue?:boolean;readAt?:string|null;href?:string|null;actionable?:boolean;handledAction?:string;handledAt?:string;nextReminderAt?:string;settingRefs?:Array<{id:string;label:string}>;actions?:NavigationAction[]}
export function OrbitNotificationCard({meta,title,onRefresh}:{meta:NotificationMeta;title:string;onRefresh?:()=>void}) {
  const {authHeaders}=useAuth();const ref=useRef<HTMLDivElement>(null);const [busy,setBusy]=useState(false),[error,setError]=useState(''),[read,setRead]=useState(!!meta.readAt);
  useEffect(()=>{if(read||!meta.notificationId||!ref.current)return;const c=new AbortController();const observer=new IntersectionObserver(entries=>{if(!entries.some(e=>e.isIntersecting)||document.visibilityState!=='visible')return;observer.disconnect();void fetch(`/api/notifications/${encodeURIComponent(meta.notificationId!)}/read`,{method:'POST',headers:authHeaders(),signal:c.signal}).then(r=>{if(r.ok)setRead(true);}).catch(()=>undefined);},{threshold:0.5});observer.observe(ref.current);return()=>{observer.disconnect();c.abort();};},[meta.notificationId,read,authHeaders]);
  const act=async(action:string)=>{if(!meta.notificationId)return;setBusy(true);setError('');try{const r=await fetch(`/api/orbit/notifications/${encodeURIComponent(meta.notificationId)}/${action}`,{method:'POST',headers:authHeaders()});const d=await r.json();if(!r.ok)throw new Error(d.error||'通知操作失败');window.dispatchEvent(new Event('orbit:data-change'));onRefresh?.();}catch(e){setError(e instanceof Error?e.message:'通知操作失败');onRefresh?.();}finally{setBusy(false);}};
  if(meta.origin!=='notification')return null;
  const validId=typeof meta.notificationId==='string'&&meta.notificationId.length>0;
  const canContinue=validId&&meta.state!=='discarded'&&meta.canContinue!==false;
  return <div ref={ref} className="orbit-notification-actions"><small>来源：{meta.sourceLabel||'Orbit'}</small>{(meta.state==='handled'||meta.state==='discarded'||meta.nextReminderAt)&&<span className="orbit-notification-state">{meta.state==='handled'?'事项已处理':meta.state==='discarded'?'事项已变化或不可用':''}{meta.nextReminderAt&&`${meta.state==='handled'||meta.state==='discarded'?' · ':''}再提醒 ${new Date(meta.nextReminderAt).toLocaleString()}`}</span>}<div>
    {validId&&meta.state!=='discarded'&&meta.href&&<Tooltip content="查看原对象"><IconLink to={meta.href} label="查看原对象"><ArrowUpRight size={16} strokeWidth={1.8} aria-hidden="true" /></IconLink></Tooltip>}
    {canContinue&&<Tooltip content="就此继续聊"><IconButton label="就此继续聊" variant="quiet" size="small" onClick={()=>window.dispatchEvent(new CustomEvent('orbit:continue-notification',{detail:{notificationId:meta.notificationId,title}}))}><MessageCircle size={16} strokeWidth={1.8} aria-hidden="true" /></IconButton></Tooltip>}
    {meta.actionable&&meta.state==='sent'&&<ReminderActionButtons busy={busy} onAction={action => void act(action)} />}</div>{error&&<p role="alert">{error}</p>}</div>;
}
