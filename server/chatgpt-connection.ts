import { randomUUID } from 'node:crypto';
import { queryOne } from './database/connection.js';
import { getUserById } from './db.js';
import { loadSecret,saveSecret,withSecretLock } from './orbit-credential-vault.js';
import { CHATGPT_ISSUER,CHATGPT_RESOURCE,verifyOpenAIToken,tokenRecord,type ChatGPTCredential } from './chatgpt-oauth.js';
export function chatGPTOwner(userId:string):boolean {
  const user=getUserById(userId);if(!user||user.disabled)return false;
  return userId===(process.env.ORBIT_CHATGPT_OWNER_ID||queryOne<{id:string}>("SELECT id FROM users WHERE role='admin' AND disabled=0 ORDER BY created_at,id LIMIT 1")?.id);
}
export function chatGPTStatus(userId:string){const eligible=chatGPTOwner(userId),c=eligible?loadSecret<ChatGPTCredential>('chatgpt',userId):undefined;return {eligible,connected:!!c?.access_token,email:c?.email,status:c?.status||'disconnected',expiresAt:c?.access_token?new Date(c.expires_at).toISOString():undefined,clientId:c?.client_id,manualOnly:true};}
export function hostId():string {let host=loadSecret<{id:string}>('host','server');if(!host){host={id:'urn:uuid:'+randomUUID()};saveSecret('host','server',host);}return host.id;}
export async function importChatGPTCredential(userId:string,value:any,fetcher:typeof fetch=fetch) {
  if(!chatGPTOwner(userId))throw new Error('ChatGPT 试点仅对主账号开放');
  // Preserve the server's own host identity before importing the portable session.
  const serverHost=hostId();
  if(value?.issuer!==CHATGPT_ISSUER||typeof value.client_id!=='string'||value.client_id==='dynamic_agent_client'||typeof value.id_token!=='string'||typeof value.access_token!=='string'||typeof value.refresh_token!=='string')throw new Error('请选择本地授权助手生成的完整凭据文件');
  const claims=await verifyOpenAIToken(value.id_token,value.client_id,value.nonce,fetcher);
  const access=await verifyOpenAIToken(value.access_token,CHATGPT_RESOURCE,undefined,fetcher);
  if(access.sub!==claims.sub||access.client_id!==value.client_id)throw new Error('授权令牌身份不匹配');
  const scopes=String(access.scope||'').split(/\s+/);if(!['chatgpt.tokens.use.direct','resource.invoke','offline_access'].every(s=>scopes.includes(s)))throw new Error('仅登录权限不能调用 ChatGPT 套餐模型');
  const credential:ChatGPTCredential={client_id:value.client_id,issuer:CHATGPT_ISSUER,subject:claims.sub!,email:typeof claims.email==='string'?claims.email:undefined,id_token:value.id_token,access_token:value.access_token,refresh_token:value.refresh_token,scopes,expires_at:access.exp!*1000,earliest_refresh_at:value.earliest_refresh_at,ext_agent_host_id:serverHost,status:'connected'};
  await withSecretLock('chatgpt',userId,async()=>{const old=loadSecret<ChatGPTCredential>('chatgpt',userId);if(old&&(old.client_id!==credential.client_id||old.subject!==credential.subject))throw new Error('导入账号与保存的注册身份不匹配');saveSecret('chatgpt',userId,credential);});return chatGPTStatus(userId);
}
const refreshing=new Map<string,Promise<string>>();
export async function chatGPTAccessToken(userId:string,fetcher:typeof fetch=fetch):Promise<string> {
  if(!chatGPTOwner(userId))throw new Error('ChatGPT Provider 不对当前账号开放');
  const c=loadSecret<ChatGPTCredential>('chatgpt',userId);if(!c?.access_token||!c.refresh_token)throw new Error('请先使用 ChatGPT 登录');
  if(c.expires_at>Date.now()+60000)return c.access_token;
  if(refreshing.has(userId))return refreshing.get(userId)!;
  const task=withSecretLock('chatgpt',userId,async()=>{
    const current=loadSecret<ChatGPTCredential>('chatgpt',userId);if(!current?.refresh_token)throw new Error('请重新登录 ChatGPT');
    if(current.expires_at>Date.now()+60000)return current.access_token!;
    const earliest=typeof current.earliest_refresh_at==='number'?current.earliest_refresh_at*1000:Date.parse(current.earliest_refresh_at||'');
    if(earliest>Date.now()){if(current.expires_at>Date.now())return current.access_token!;throw new Error('尚未到允许刷新时间，请稍后重试');}
    const res=await fetcher(CHATGPT_ISSUER+'/api/accounts/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:current.client_id,refresh_token:current.refresh_token,resource:CHATGPT_RESOURCE}),signal:AbortSignal.timeout(15000)});
    const raw=await res.json();
    if(!res.ok){const code=String(raw.error?.code||raw.error||'');if(/^(invalid_grant|invalid_refresh_token|token_expired|refresh_token_expired|refresh_token_invalidated|refresh_token_reused)$/.test(code)){saveSecret('chatgpt',userId,{client_id:current.client_id,issuer:current.issuer,subject:current.subject,email:current.email,ext_agent_host_id:current.ext_agent_host_id,scopes:[],expires_at:0,status:'reauthorization_required'});}throw new Error(`ChatGPT 刷新失败（${res.status}），${res.status>=500?'凭据已保留，请稍后重试':'请检查授权状态'}`);}
    const next=tokenRecord({...raw,scope:raw.scope||current.scopes.join(' ')},current);next.id_token=raw.id_token||current.id_token;
    saveSecret('chatgpt',userId,next);return next.access_token!;
  });refreshing.set(userId,task);try{return await task;}finally{refreshing.delete(userId);}
}
export async function disconnectChatGPT(userId:string,fetcher:typeof fetch=fetch){
  if(!chatGPTOwner(userId))throw new Error('无权访问此连接');
  return withSecretLock('chatgpt',userId,async()=>{const c=loadSecret<ChatGPTCredential>('chatgpt',userId);let revoked=false;
    if(c?.refresh_token)try{const d=await fetcher(CHATGPT_ISSUER+'/.well-known/openid-configuration',{signal:AbortSignal.timeout(10000)});const info=await d.json();const endpoint=new URL(info.revocation_endpoint);if(endpoint.origin!==CHATGPT_ISSUER)throw new Error('撤销地址无效');const r=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:c.refresh_token,token_type_hint:'refresh_token',client_id:c.client_id}),signal:AbortSignal.timeout(10000)});revoked=r.status===200;}catch{}
    if(c)saveSecret('chatgpt',userId,{client_id:c.client_id,issuer:c.issuer,subject:c.subject,email:c.email,ext_agent_host_id:c.ext_agent_host_id,scopes:[],expires_at:0,status:'disconnected'});
    return {success:true,revoked,message:revoked?'已断开并撤销会话':'本地已断开，远程撤销未确认，请在 ChatGPT 设置中检查应用访问'};
  });
}
