import { Router } from 'express';
import type { createAuth, JwtPayload } from '../auth.js';
import * as push from '../android-push.js';

export function createAndroidPushRouter({authenticate}:Pick<ReturnType<typeof createAuth>,'authenticate'>) {
  const router=Router();
  const handle=(fn:(req:any,res:any)=>unknown)=>async(req:any,res:any)=>{try{await fn(req,res);}catch(e){res.status(e instanceof push.PushInputError?e.status:500).json({error:e instanceof push.PushInputError?e.message:'Android 通知操作失败'});}};
  const user=(req:any)=>(req.user as JwtPayload).userId;
  router.get('/api/android-push',authenticate,handle((req,res)=>res.json({enabled:push.pushEnabled(user(req)),configured:push.pushConfigured(),scannerEnabled:process.env.ANDROID_PUSH_ENABLED==='true',devices:push.publicDevices(user(req))})));
  router.put('/api/android-push/preferences',authenticate,handle((req,res)=>{if(typeof req.body.enabled!=='boolean')throw new push.PushInputError('enabled 必须为布尔值');push.setPushEnabled(user(req),req.body.enabled);res.json({enabled:push.pushEnabled(user(req))});}));
  router.post('/api/android-push/devices',authenticate,handle((req,res)=>res.json(push.registerDevice(user(req),req.body))));
  router.delete('/api/android-push/devices/:id',authenticate,handle((req,res)=>{push.revokeDevice(user(req),req.params.id);res.json({revoked:true});}));
  router.post('/api/android-push/revoke',handle((req,res)=>{if(typeof req.body.id!=='string'||typeof req.body.generation!=='string'||typeof req.body.key!=='string'||req.body.key.length>128)throw new push.PushInputError('解绑格式不正确');push.revokeByCapability(req.body.id,req.body.generation,req.body.key);res.json({revoked:true});}));
  router.post('/api/android-push/devices/:id/test',authenticate,handle(async(req,res)=>{const d=push.queuePushTest(user(req),req.params.id);await push.processPushQueue(new Date(),d.id);res.json(push.pushResult(user(req),d.id));}));
  router.get('/api/android-push/notifications/:id',authenticate,handle((req,res)=>res.json(push.pushResult(user(req),req.params.id))));
  return router;
}
