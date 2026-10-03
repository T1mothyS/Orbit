import http from 'node:http';
import { createHash,randomBytes,createPublicKey,timingSafeEqual } from 'node:crypto';
import jwt, { type JwtPayload } from 'jsonwebtoken';
export const CHATGPT_ISSUER='https://auth.openai.com';
export const CHATGPT_RESOURCE='https://api.openai.com/v1';
export const CHATGPT_SCOPES='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
export interface ChatGPTCredential {
  client_id:string;issuer:string;subject:string;email?:string;id_token?:string;access_token?:string;refresh_token?:string;
  scopes:string[];expires_at:number;earliest_refresh_at?:number|string;ext_agent_host_id:string;nonce?:string;status?:string;
}
export async function verifyOpenAIToken(token:string,audience:string,nonce?:string,fetcher:typeof fetch=fetch):Promise<JwtPayload> {
  const decoded=jwt.decode(token,{complete:true});if(!decoded||typeof decoded==='string'||!decoded.header.kid)throw new Error('授权身份无效');
  const res=await fetcher(CHATGPT_ISSUER+'/.well-known/jwks.json',{signal:AbortSignal.timeout(10000)});if(!res.ok)throw new Error('无法核对授权签名');
  const data=await res.json();const key=data.keys?.find((k:any)=>k.kid===decoded.header.kid&&(!k.use||k.use==='sig'));if(!key)throw new Error('授权签名不可识别');
  const claims=jwt.verify(token,createPublicKey({key,format:'jwk'}),{algorithms:['RS256','ES256'],issuer:CHATGPT_ISSUER,audience}) as JwtPayload;
  if(typeof claims.sub!=='string'||!claims.sub||!claims.exp||(nonce!==undefined&&claims.nonce!==nonce))throw new Error('授权身份或 nonce 不匹配');return claims;
}
export function tokenRecord(raw:any,registration:Pick<ChatGPTCredential,'client_id'|'subject'|'issuer'|'email'|'ext_agent_host_id'>,now=Date.now()):ChatGPTCredential {
  if(typeof raw.access_token!=='string'||typeof raw.refresh_token!=='string'||raw.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(raw.expires_in)||raw.expires_in<=0)throw new Error('授权令牌响应不完整');
  const scopes=String(raw.scope||'').split(/\s+/).filter(Boolean);if(!['resource.invoke','chatgpt.tokens.use.direct','offline_access'].every(s=>scopes.includes(s)))throw new Error('尚未授予 ChatGPT 套餐模型调用权限，请重新授权');
  return {...registration,access_token:raw.access_token,refresh_token:raw.refresh_token,id_token:raw.id_token,scopes,expires_at:now+raw.expires_in*1000,earliest_refresh_at:raw.earliest_refresh_at,status:'connected'};
}
export async function beginLocalChatGPTAuth(hostId:string,old?:ChatGPTCredential,fetcher:typeof fetch=fetch) {
  const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');
  let resolve!:(v:ChatGPTCredential)=>void,reject!:(e:Error)=>void,consumed=false;
  const result=new Promise<ChatGPTCredential>((a,b)=>{resolve=a;reject=b;});
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/plain; charset=utf-8');
    const address=server.address() as {port:number};
    if(req.method!=='GET'||req.headers.host!==`127.0.0.1:${address.port}`){res.writeHead(400).end('Invalid callback');return;}
    const u=new URL(req.url||'/',`http://127.0.0.1:${address.port}`),got=u.searchParams.get('state')||'';
    if(u.pathname!=='/auth/callback'||Buffer.byteLength(got)!==Buffer.byteLength(state)||!timingSafeEqual(Buffer.from(got),Buffer.from(state))||consumed){res.writeHead(400).end('Invalid callback');return;}
    consumed=true;
    try {
      if(u.searchParams.has('error'))throw new Error(u.searchParams.get('error')==='access_denied'?'用户拒绝了授权':'ChatGPT 授权失败');
      const clientId=u.searchParams.get('client_id')||old?.client_id;
      if(!clientId||clientId==='dynamic_agent_client'||(old&&clientId!==old.client_id))throw new Error('授权 client ID 不匹配');
      const code=u.searchParams.get('code');if(!code)throw new Error('授权未返回 code');
      const redirect=`http://127.0.0.1:${address.port}/auth/callback`;
      const exchange=await fetcher(CHATGPT_ISSUER+'/api/accounts/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,code,code_verifier:verifier,redirect_uri:redirect,resource:CHATGPT_RESOURCE}),signal:AbortSignal.timeout(15000)});
      if(!exchange.ok)throw new Error(`授权交换失败（${exchange.status}），请重新登录`);
      const raw=await exchange.json(),claims=await verifyOpenAIToken(raw.id_token,clientId,nonce,fetcher);
      if(old&&claims.sub!==old.subject)throw new Error('返回身份与原 ChatGPT 账号不匹配');
      const record=tokenRecord(raw,{client_id:clientId,subject:claims.sub!,issuer:CHATGPT_ISSUER,email:typeof claims.email==='string'?claims.email:undefined,ext_agent_host_id:hostId});record.nonce=nonce;
      resolve(record);res.end('Orbit 授权成功。请关闭此页面，并按终端提示导入服务器。');
    }catch(e){const error=e instanceof Error?e:new Error('授权失败');reject(error);res.writeHead(400).end(error.message);}finally{clearTimeout(timer);server.close();}
  });
  await new Promise<void>((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',()=>r());});
  const port=(server.address() as {port:number}).port;
  const timer=setTimeout(()=>{server.close();reject(new Error('授权已超时，请重新开始'));},10*60*1000);
  const url=new URL(CHATGPT_ISSUER+'/api/accounts/authorize');url.search=new URLSearchParams({client_id:old?.client_id||'dynamic_agent_client',...(!old?{agent_name_hint:'Orbit'}:{}),ext_agent_host_id:hostId,response_type:'code',redirect_uri:`http://127.0.0.1:${port}/auth/callback`,scope:CHATGPT_SCOPES,resource:CHATGPT_RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),...(old?.id_token?{id_token_hint:old.id_token}:{})}).toString();
  return {url:url.href,result,cancel:()=>{clearTimeout(timer);server.close();reject(new Error('授权已取消'));}};
}
