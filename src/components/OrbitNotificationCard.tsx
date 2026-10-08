import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2, Reply } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
export interface NotificationMeta {origin:string;sourceLabel?:string;eventId?:string;notificationId?:string;enhanced?:boolean;state?:string;canContinue?:boolean;readAt?:string|null;href?:string|null;actionable?:boolean;handledAction?:string;handledAt?:string;nextReminderAt?:string;settingRefs?:Array<{id:string;label:string}>}
export function OrbitNotificationCard({meta,title,onRefresh}:{meta:NotificationMeta;title:string;onRefresh?:()=>void}) {
  const {authHeaders}=useAuth();const ref=useRef<HTMLDivElement>(null);const [busy,setBusy]=useState(false),[error,setError]=useState(''),[read,setRead]=useState(!!meta.readAt);
  useEffect(()=>{if(read||!meta.notificationId||!ref.current)return;const c=new AbortController();const observer=new IntersectionObserver(entries=>{if(!entries.some(e=>e.isIntersecting)||document.visibilityState!=='visible')return;observer.disconnect();void fetch(`/api/notifications/${encodeURIComponent(meta.notificationId!)}/read`,{method:'POST',headers:authHeaders(),signal:c.signal}).then(r=>{if(r.ok)setRead(true);}).catch(()=>undefined);},{threshold:0.5});observer.observe(ref.current);return()=>{observer.disconnect();c.abort();};},[meta.notificationId,read,authHeaders]);
  const act=async(action:string)=>{if(!meta.notificationId)return;setBusy(true);setError('');try{const r=await fetch(`/api/orbit/notifications/${encodeURIComponent(meta.notificationId)}/${action}`,{method:'POST',headers:authHeaders()});const d=await r.json();if(!r.ok)throw new Error(d.error||'通知操作失败');window.dispatchEvent(new Event('orbit:data-change'));onRefresh?.();}catch(e){setError(e instanceof Error?e.message:'通知操作失败');onRefresh?.();}finally{setBusy(false);}};
  if(meta.origin!=='notification')return null;
  const validId=typeof meta.notificationId==='string'&&meta.notificationId.length>0;
  const canContinue=validId&&meta.state!=='discarded'&&meta.canContinue!==false;
  return <div ref={ref} className="orbit-notification-actions"><small>来源：{meta.sourceLabel||'Orbit'}</small><span className="orbit-notification-state">{meta.state==='handled'?'事项已处理':meta.state==='discarded'?'事项已变化或不可用':read?'已读':'未读'}{meta.nextReminderAt&&` · 再提醒 ${new Date(meta.nextReminderAt).toLocaleString()}`}</span><div>
    {validId&&meta.state!=='discarded'&&meta.href&&<Link className="orbit-notification-action" to={meta.href} title="查看原对象" aria-label="查看原对象"><Link2 size={16} aria-hidden="true"/><span className="notification-action-label">查看原对象</span></Link>}
    {canContinue&&<button className="orbit-notification-action" type="button" title="就此继续聊" aria-label="就此继续聊" onClick={()=>window.dispatchEvent(new CustomEvent('orbit:continue-notification',{detail:{notificationId:meta.notificationId,title}}))}><Reply size={16} aria-hidden="true"/><span className="notification-action-label">就此继续聊</span></button>}
    {meta.actionable&&meta.state==='sent'&&[['complete','完成'],['snooze','15 分钟后'],['tomorrow','明天 09:00']].map(([action,label])=><button type="button" key={action} disabled={busy} onClick={()=>void act(action)}>{label}</button>)}</div>{error&&<p role="alert">{error}</p>}</div>;
}
