import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Avatar } from '../ui';
export function AccountAvatar({email,size=32}:{email:string;size?:number}) {
  const {authHeaders}=useAuth();const [url,setUrl]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{const update=()=>setRevision(n=>n+1);window.addEventListener('orbit:profile-change',update);return()=>window.removeEventListener('orbit:profile-change',update);},[]);
  useEffect(()=>{let cancelled=false,objectUrl='';const controller=new AbortController(),headers=authHeaders();setUrl('');void (async()=>{const profile=await fetch('/api/orbit/profile',{headers,signal:controller.signal});if(!profile.ok||!(await profile.json()).avatarId)return;const r=await fetch('/api/orbit/profile/avatar',{headers,signal:controller.signal});if(!r.ok)return;objectUrl=URL.createObjectURL(await r.blob());if(!cancelled)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl);})().catch(()=>undefined);return()=>{cancelled=true;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};},[authHeaders,email,revision]);
  return <Avatar label={email} src={url} size={size===48?48:32} />;
}
