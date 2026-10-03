import {Router} from 'express';
import type {createAuth} from '../auth.js';
import * as files from '../orbit-attachments.js';
import {getAttachment} from '../activity-store.js';
import {readAttachment} from '../attachment-service.js';
export function createOrbitAttachmentsRouter({authenticate}:Pick<ReturnType<typeof createAuth>,'authenticate'>){
  const router=Router(),user=(req:any)=>req.user.userId as string;
  const safe=(fn:(req:any,res:any)=>unknown)=>(req:any,res:any)=>{try{fn(req,res);}catch(error){res.status(400).json({error:error instanceof Error?error.message:'附件请求失败'});}};
  router.get('/api/orbit/conversations/:id/attachments',authenticate,safe((req,res)=>res.json({attachments:files.listChatAttachments(user(req),req.params.id)})));
  router.get('/api/orbit/attachments/:id',authenticate,safe((req,res)=>{files.attachment(user(req),req.params.id);const record=getAttachment(req.params.id,user(req))!;res.setHeader('Content-Type',record.mimeType);res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(record.originalName)}`);res.send(readAttachment(record));}));
  router.delete('/api/orbit/attachments/:id',authenticate,safe((req,res)=>{files.deleteChatAttachment(user(req),req.params.id);res.json({success:true});}));
  const processing=(retry:boolean)=>async(req:any,res:any)=>{const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.on('close',abort);try{const result=retry?await files.processChatAttachment(user(req),req.params.id,controller.signal):await files.uploadChatAttachment(user(req),req.params.id,req.body,controller.signal);if(!res.destroyed)res.json({attachment:result});}catch(error){if(!res.destroyed)res.status(400).json({error:error instanceof Error?error.message:'附件处理失败'});}finally{res.off('close',abort);}};
  router.post('/api/orbit/conversations/:id/attachments',authenticate,processing(false));
  router.post('/api/orbit/attachments/:id/retry',authenticate,processing(true));
  return router;
}
