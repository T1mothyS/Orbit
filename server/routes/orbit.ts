import { Router, type RequestHandler } from 'express';
import { getOrbitStatistics, recordKnowledgeRead } from '../orbit-statistics.js';
import { getScheduleReminder, setScheduleReminder, actOnProactiveEvent } from '../orbit-proactive.js';
import { getProfile, saveAvatar, removeAvatar, avatarBytes } from '../orbit-profile.js';
import { activityReportFreshness,createActivityReport, getActivityReport, listActivityReports, generateReportInsights, deliverActivityReport, reportDeliveryStatus, getWeeklyPreferences, setWeeklyPreferences } from '../activity-reports.js';
import { findSettings } from '../../src/utils/settings-registry.js';
import { eventForNotification,processInAppNotifications } from '../notification-chat.js';
export function createOrbitFeatureRouter({authenticate}:{authenticate:RequestHandler}) {
  const app=Router();
  const safe=(fn:(req:any,res:any)=>void)=>(req:any,res:any)=>{try{res.setHeader('Cache-Control','no-store');fn(req,res);}catch(e:any){res.status(400).json({error:e.message});}};
  app.get('/api/orbit/statistics',authenticate,safe((req,res)=>{
    const data=getOrbitStatistics(req.user.userId,String(req.query.period||'week'),req.query.date?String(req.query.date):undefined,new Date(),{taskType:String(req.query.taskType||'all'),reportSource:String(req.query.reportSource||'all'),from:req.query.from?String(req.query.from):undefined,to:req.query.to?String(req.query.to):undefined});
    if(req.query.metric){const rows=data.activity.metricDetails[String(req.query.metric)];if(!rows)throw new Error('统计明细类型无效');const offset=Number(req.query.offset||0),limit=Number(req.query.limit||50);if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>100)throw new Error('分页参数无效');return res.json({total:rows.length,rows:rows.slice(offset,offset+limit),window:data.window});}res.json(data);
  }));
  app.get('/api/orbit/settings/search',authenticate,safe((req,res)=>res.json({items:findSettings(String(req.query.q||''),req.user.role==='admin')})));
  app.get('/api/orbit/profile',authenticate,safe((req,res)=>res.json(getProfile(req.user.userId))));
  app.get('/api/orbit/profile/avatar',authenticate,(req:any,res)=>{try{res.setHeader('Cache-Control','private, no-store');res.type('image/webp').send(avatarBytes(req.user.userId));}catch{res.status(404).json({error:'头像不存在'});}});
  app.post('/api/orbit/profile/avatar',authenticate,async(req:any,res)=>{try{res.json(await saveAvatar(req.user.userId,req.body||{}));}catch(e:any){res.status(400).json({error:e.message});}});
  app.delete('/api/orbit/profile/avatar',authenticate,safe((req,res)=>res.json(removeAvatar(req.user.userId))));
  app.get('/api/orbit/weekly/preferences',authenticate,safe((req,res)=>res.json(getWeeklyPreferences(req.user.userId))));
  app.patch('/api/orbit/weekly/preferences',authenticate,safe((req,res)=>res.json(setWeeklyPreferences(req.user.userId,req.body))));
  app.get('/api/orbit/activity-reports',authenticate,safe((req,res)=>res.json({reports:listActivityReports(req.user.userId)})));
  app.post('/api/orbit/activity-reports',authenticate,safe((req,res)=>res.json(createActivityReport(req.user.userId,req.body||{}))));
  app.get('/api/orbit/activity-reports/:id',authenticate,safe((req,res)=>res.json({...getActivityReport(req.user.userId,req.params.id),deliveries:reportDeliveryStatus(req.user.userId,req.params.id)})));
  app.get('/api/orbit/activity-reports/:id/current',authenticate,safe((req,res)=>res.json(activityReportFreshness(req.user.userId,req.params.id))));
  app.post('/api/orbit/activity-reports/:id/insights',authenticate,async(req:any,res)=>{try{res.json(await generateReportInsights(req.user.userId,req.params.id));}catch(e:any){res.status(400).json({error:e.message});}});
  app.post('/api/orbit/activity-reports/:id/deliver',authenticate,safe((req,res)=>{if(req.body?.confirm!==true)throw new Error('请确认投递这份报告');deliverActivityReport(req.user.userId,req.params.id);processInAppNotifications();res.json({deliveries:reportDeliveryStatus(req.user.userId,req.params.id)});}));
  app.post('/api/orbit/knowledge/:id/read',authenticate,safe((req,res)=>{recordKnowledgeRead(req.user.userId,req.params.id);res.json({success:true});}));
  app.get('/api/orbit/schedules/:id/reminder',authenticate,safe((req,res)=>res.json(getScheduleReminder(req.user.userId,req.params.id))));
  app.patch('/api/orbit/schedules/:id/reminder',authenticate,safe((req,res)=>{if(typeof req.body?.enabled!=='boolean')throw new Error('提醒设置无效');setScheduleReminder(req.user.userId,req.params.id,req.body.enabled,req.body.minutes);res.json({success:true});}));
  app.post('/api/orbit/reminders/:id/:action',authenticate,safe((req,res)=>{actOnProactiveEvent(req.user.userId,req.params.id,req.params.action);res.json({success:true});}));
  app.post('/api/orbit/notifications/:id/:action',authenticate,safe((req,res)=>{const id=eventForNotification(req.user.userId,req.params.id);actOnProactiveEvent(req.user.userId,id,req.params.action);res.json({success:true});}));
  return app;
}
