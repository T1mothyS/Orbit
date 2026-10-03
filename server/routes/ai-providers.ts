import { Router,type RequestHandler } from 'express';
import { chatGPTStatus,importChatGPTCredential,disconnectChatGPT,chatGPTOwner } from '../chatgpt-connection.js';
import { chatGPTModels } from '../ai-provider-chatgpt.js';
import { loadSecret } from '../orbit-credential-vault.js';
import type { ChatGPTCredential } from '../chatgpt-oauth.js';
export function createAiProvidersRouter({authenticate}:{authenticate:RequestHandler}) {
  const app=Router();
  const safe=(fn:(req:any,res:any)=>Promise<any>|any)=>(req:any,res:any)=>{res.setHeader('Cache-Control','no-store');Promise.resolve().then(()=>fn(req,res)).catch(e=>res.status(400).json({error:e.message||'Provider 操作失败'}));};
  app.get('/api/orbit/chatgpt',authenticate,safe((req,res)=>res.json(chatGPTStatus(req.user.userId))));
  app.post('/api/orbit/chatgpt/import',authenticate,safe(async(req,res)=>{if(req.secure!==true && req.hostname!=='127.0.0.1'&&req.hostname!=='localhost')return res.status(400).json({error:'导入凭据必须通过 HTTPS 或本机 loopback'});res.json(await importChatGPTCredential(req.user.userId,req.body));}));
  app.get('/api/orbit/chatgpt/registration',authenticate,safe((req,res)=>{if(!chatGPTOwner(req.user.userId))return res.status(403).json({error:'无权访问此连接'});const c=loadSecret<ChatGPTCredential>('chatgpt',req.user.userId);if(!c)throw new Error('还没有注册记录');res.json({client_id:c.client_id,issuer:c.issuer,subject:c.subject,email:c.email});}));
  app.post('/api/orbit/chatgpt/disconnect',authenticate,safe(async(req,res)=>res.json(await disconnectChatGPT(req.user.userId))));
  app.get('/api/orbit/chatgpt/models',authenticate,safe(async(req,res)=>res.json({models:await chatGPTModels(req.user.userId)})));
  return app;
}
