import { useEffect,useState } from 'react';
import { Button } from 'tdesign-react';
import { SettingRow,SettingInput } from '../SettingRow';
import type { SettingsAuthHeaders } from '../types';
export function SearchSettings({authHeaders,isAdmin}:{authHeaders:SettingsAuthHeaders;isAdmin:boolean}) {
  const [status,setStatus]=useState<{configured:boolean;used:number;limit:number;stopped:boolean}>(),[key,setKey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let live=true;void fetch('/api/orbit/search',{headers:authHeaders()}).then(async r=>{if(!r.ok)throw new Error('无法读取搜索配置');const d=await r.json();if(live)setStatus(d);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[authHeaders]);
  const save=async()=>{setBusy(true);setError('');try{const r=await fetch('/api/orbit/search',{method:'PUT',headers:{...authHeaders(),'Content-Type':'application/json'},body:JSON.stringify({key})});const d=await r.json();if(!r.ok)throw new Error(d.error||'保存失败');setStatus(d);setKey('');}catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}};
  return <SettingRow label="联网搜索" htmlFor="settings-search-key" description="Tavily 基础搜索；每轮最多两次，每月达到上限或服务额度不足时停止。请在服务商账户关闭自动付费。">
    <div className="settings-stack"><p role="status">{status?`${status.configured?'已配置':'未配置'} · 本月请求 ${status.used}/${status.limit}${status.stopped?' · 已停止':''}`:'正在读取…'}</p>
      {isAdmin&&<><SettingInput id="settings-search-key" type="password" value={key} onChange={v=>setKey(String(v))} placeholder="管理员填写服务端 Tavily Key" autocomplete="new-password"/><div className="settings-actions"><Button loading={busy} disabled={!key.trim()} onClick={save}>保存 Key</Button><Button disabled={busy||!status?.configured} variant="outline" onClick={()=>{setKey('');void fetch('/api/orbit/search',{method:'PUT',headers:{...authHeaders(),'Content-Type':'application/json'},body:JSON.stringify({key:''})}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setStatus(d);}).catch(e=>setError(e.message));}}>移除服务端 Key</Button></div></>}{error&&<p role="alert">{error}</p>}
    </div></SettingRow>;
}
