import { useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
export function BrowserNotifications() {
  const {authHeaders}=useAuth();
  useEffect(()=>{let stopped=false,busy=false;const controller=new AbortController();const poll=async()=>{if(stopped||busy||!('Notification' in window)||Notification.permission!=='granted')return;busy=true;try{const response=await fetch('/api/notifications?channel=browser&unread=1&limit=30',{headers:authHeaders(),signal:controller.signal});if(!response.ok)return;const data=await response.json();for(const item of (data.notifications||[]).slice(0,3)){if(stopped)return;new Notification(item.title,{body:item.body,tag:item.id});await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`,{method:'POST',headers:authHeaders(),signal:controller.signal});}}catch{/* Next poll retries; browser delivery never blocks the page. */}finally{busy=false;}};void poll();const timer=setInterval(()=>void poll(),60000);window.addEventListener('focus',poll);return()=>{stopped=true;controller.abort();clearInterval(timer);window.removeEventListener('focus',poll);};},[authHeaders]);
  return null;
}
