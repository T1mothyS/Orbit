import { Router,type RequestHandler } from 'express';
import { chatGPTStatus,importChatGPTCredential,disconnectChatGPT,chatGPTOwner } from '../chatgpt-connection.js';
import { chatGPTModels } from '../ai-provider-chatgpt.js';
import { loadSecret } from '../orbit-credential-vault.js';
import type { ChatGPTCredential } from '../chatgpt-oauth.js';
import {chatGPTProvider,chatGPTCapabilityVersion} from '../ai-provider-chatgpt.js';
import {workBuddyProvider} from '../ai-provider-workbuddy.js';
import {resolveCodeBuddyCredential,modelService} from '../ai-credentials.js';
import {recordVerifiedCapability,capabilityCredentialVersion} from '../ai-model-capabilities.js';
import {probeCapability} from '../ai-capability-probe.js';
export function createAiProvidersRouter({authenticate}:{authenticate:RequestHandler}) {
  const app=Router();
  const safe=(fn:(req:any,res:any)=>Promise<any>|any)=>(req:any,res:any)=>{res.setHeader('Cache-Control','no-store');Promise.resolve().then(()=>fn(req,res)).catch(e=>res.status(400).json({error:e.message||'Provider 操作失败'}));};
  app.get('/api/orbit/chatgpt',authenticate,safe((req,res)=>res.json(chatGPTStatus(req.user.userId))));
  app.post('/api/orbit/chatgpt/import',authenticate,safe(async(req,res)=>{const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')&&['127.0.0.1','localhost','[::1]'].includes(req.hostname);if(req.secure!==true&&!local)return res.status(400).json({error:'导入凭据必须通过 HTTPS 或本机 loopback'});res.json(await importChatGPTCredential(req.user.userId,req.body));}));
  app.get('/api/orbit/chatgpt/registration',authenticate,safe((req,res)=>{if(!chatGPTOwner(req.user.userId))return res.status(403).json({error:'无权访问此连接'});const c=loadSecret<ChatGPTCredential>('chatgpt',req.user.userId);if(!c)throw new Error('还没有注册记录');res.json({client_id:c.client_id,issuer:c.issuer,subject:c.subject,email:c.email});}));
  app.post('/api/orbit/chatgpt/disconnect',authenticate,safe(async(req,res)=>res.json(await disconnectChatGPT(req.user.userId))));
  app.get('/api/orbit/chatgpt/models',authenticate,safe(async(req,res)=>res.json({models:await chatGPTModels(req.user.userId)})));
  app.post('/api/orbit/providers/probe',authenticate,safe(async(req,res)=>{
    const {provider,model,capability}=req.body||{},uid=req.user.userId;
    if(!['workbuddy','chatgpt'].includes(provider)||typeof model!=='string'||!model.trim()||model.length>200||!['images','tools'].includes(capability))throw new Error('能力测试参数不正确');
    const credential=resolveCodeBuddyCredential(uid);if(provider==='workbuddy'&&!credential)throw new Error('请先配置 WorkBuddy');if(provider==='chatgpt'&&!chatGPTStatus(uid).connected)throw new Error('请先连接 ChatGPT');
    const version=provider==='chatgpt'?chatGPTCapabilityVersion(uid):capabilityCredentialVersion(credential!.api_key+'\0'+credential!.updated_at);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000),abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);
    try{await probeCapability(provider==='chatgpt'?chatGPTProvider:workBuddyProvider,uid,model,capability,controller);if(provider==='chatgpt'&&version!==chatGPTCapabilityVersion(uid))throw new Error('连接已变化，请重新验证');recordVerifiedCapability(uid,provider,model,version,capability);modelService.invalidate(uid);if(!res.destroyed)res.json({verified:true});}finally{clearTimeout(timer);res.off('close',abort);}
  }));
  return app;
}
