import { Router, type RequestHandler } from 'express';
import { getOrbitStatistics, recordKnowledgeRead } from '../orbit-statistics.js';
import { getScheduleReminder, setScheduleReminder, actOnProactiveEvent } from '../orbit-proactive.js';
export function createOrbitFeatureRouter({authenticate}:{authenticate:RequestHandler}) {
  const app=Router();
  const safe=(fn:(req:any,res:any)=>void)=>(req:any,res:any)=>{try{res.setHeader('Cache-Control','no-store');fn(req,res);}catch(e:any){res.status(400).json({error:e.message});}};
  app.get('/api/orbit/statistics',authenticate,safe((req,res)=>res.json(getOrbitStatistics(req.user.userId,String(req.query.period||'week'),req.query.date?String(req.query.date):undefined,new Date(),{taskType:String(req.query.taskType||'all'),reportSource:String(req.query.reportSource||'all')}))));
  app.post('/api/orbit/knowledge/:id/read',authenticate,safe((req,res)=>{recordKnowledgeRead(req.user.userId,req.params.id);res.json({success:true});}));
  app.get('/api/orbit/schedules/:id/reminder',authenticate,safe((req,res)=>res.json(getScheduleReminder(req.user.userId,req.params.id))));
  app.patch('/api/orbit/schedules/:id/reminder',authenticate,safe((req,res)=>{if(typeof req.body?.enabled!=='boolean')throw new Error('提醒设置无效');setScheduleReminder(req.user.userId,req.params.id,req.body.enabled,req.body.minutes);res.json({success:true});}));
  app.post('/api/orbit/reminders/:id/:action',authenticate,safe((req,res)=>{actOnProactiveEvent(req.user.userId,req.params.id,req.params.action);res.json({success:true});}));
  return app;
}
