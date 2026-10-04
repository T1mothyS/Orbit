import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
export function AccountAvatar({email,size=32}:{email:string;size?:number}) {
  const {authHeaders}=useAuth();const [url,setUrl]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{const update=()=>setRevision(n=>n+1);window.addEventListener('orbit:profile-change',update);return()=>window.removeEventListener('orbit:profile-change',update);},[]);
  useEffect(()=>{let cancelled=false,objectUrl='';const controller=new AbortController();setUrl('');void fetch('/api/orbit/profile/avatar',{headers:authHeaders(),signal:controller.signal}).then(async r=>{if(!r.ok)return;objectUrl=URL.createObjectURL(await r.blob());if(!cancelled)setUrl(objectUrl);else URL.revokeObjectURL(objectUrl);}).catch(()=>undefined);return()=>{cancelled=true;controller.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};},[authHeaders,email,revision]);
  return <span className="account-avatar" style={{width:size,height:size}}>{url?<img src={url} alt=""/>:email.slice(0,1).toLocaleUpperCase()||'O'}</span>;
}
