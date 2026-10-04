import { useState } from 'react';
import { AccountAvatar } from '../../AccountAvatar';
import { useAuth } from '../../../hooks/useAuth';
import { SettingRow } from '../SettingRow';
export function AvatarSettings({email}:{email:string}) {
  const {authHeaders}=useAuth();const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=async(method:string,body?:unknown)=>{setBusy(true);setError('');try{const r=await fetch('/api/orbit/profile/avatar',{method,headers:{...authHeaders(),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const d=await r.json();if(!r.ok)throw new Error(d.error||'头像保存失败');window.dispatchEvent(new Event('orbit:profile-change'));}catch(e){setError(e instanceof Error?e.message:'头像保存失败');}finally{setBusy(false);}};
  return <SettingRow label="用户头像" description="JPEG、PNG 或 WebP，最大 5 MB。未上传时使用默认头像。"><div className="settings-actions"><AccountAvatar email={email} size={48}/><label className="avatar-upload">{busy?'保存中…':'上传或更换'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} aria-label="上传用户头像" onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;if(file.size>5*1024*1024){setError('头像不能超过 5 MB');return;}const reader=new FileReader();reader.onload=()=>void request('POST',{mimeType:file.type,base64:String(reader.result).split(',')[1]});reader.onerror=()=>setError('图片读取失败');reader.readAsDataURL(file);}}/></label><button type="button" disabled={busy} onClick={()=>void request('DELETE')}>恢复默认头像</button></div>{error&&<p role="alert">{error}</p>}</SettingRow>;
}
