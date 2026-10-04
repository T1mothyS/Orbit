/** Isolated, loopback-only UI preview. Never loads .env or the repository data directory. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import bcrypt from 'bcryptjs';
import {randomUUID} from 'node:crypto';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-ui-preview-'));
Object.assign(process.env,{DATA_DIR:root,NODE_ENV:'test',APP_ENV:'development',JWT_SECRET:'isolated-preview-only-no-production',BACKGROUND_JOBS_ENABLED:'false',ORBIT_PROACTIVE_ENABLED:'false'});
const api=await import('../server/index.js');await api.initializeServer();
const db=await import('../server/db.js'),orbit=await import('../server/orbit-store.js'),state=await import('../server/ai-chat-state.js');
const {buildAiPlanSnapshot}=await import('../server/ai-plan.js');
const stamp=new Date().toISOString(),uid='preview-owner';
db.createUser({id:uid,email:'preview@example.invalid',password_hash:await bcrypt.hash('OrbitPreview123!',10),role:'admin',disabled:0,created_at:stamp,updated_at:stamp});
db.createUser({id:'preview-empty',email:'empty@example.invalid',password_hash:await bcrypt.hash('OrbitPreview123!',10),role:'user',disabled:0,created_at:stamp,updated_at:stamp});
const cid=orbit.ensureDefaultConversation(uid);
for(let i=0;i<12;i++)db.createAiScheduleMessage({id:randomUUID(),user_id:uid,conversation_id:cid,role:i%2?'assistant':'user',type:'text',content:i%2?'### 本周安排\n**重点**：先完成操作状态，再检查页面。\n- 上午 09:00 开会\n- 下午核对资料\n[官方来源](https://www.openai.com/)\n<script>这段内容只显示为文字</script>':'帮我整理一下本周安排。',intent:null,plan:null,schedule_items:null,created_at:new Date(Date.now()-600000+i*10000).toISOString()});
const event=randomUUID(),message=randomUUID();
const {run}=await import('../server/database/connection.js');
run('INSERT INTO orbit_proactive_events (id,user_id,schedule_id,expected_state,trigger_at,state,message_id,created_at,handled_action,handled_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[event,uid,'preview-finished','synthetic',stamp,'handled',message,stamp,'complete',stamp]);
db.createAiScheduleMessage({id:message,user_id:uid,conversation_id:cid,role:'assistant',type:'text',content:'资料已核对完成。',intent:null,plan:null,schedule_items:null,created_at:stamp,orbit_meta:JSON.stringify({origin:'proactive',eventId:event,enhanced:false})});
run('UPDATE ai_schedule_messages SET orbit_meta=? WHERE id=?',[JSON.stringify({origin:'proactive',eventId:event,enhanced:false}),message]);
const plan:import('../server/ai-chat-state.js').PendingAiSchedulePlan={id:randomUUID(),userId:uid,conversationId:cid,targetCalendarId:'personal',today:new Date().toISOString().slice(0,10),intent:'create',reply:'已准备日程草稿，请确认。',warnings:[],revision:1,state:'pending',expiresAt:Date.now()+900000,historyMessageId:randomUUID(),operations:[{key:'0',type:'create',data:{title:'开会',start_time:'2026-10-04T09:00:00',end_time:'2026-10-04T10:00:00'}}]};
db.createAiScheduleMessage({id:plan.historyMessageId!,user_id:uid,conversation_id:cid,role:'assistant',type:'plan',content:plan.reply,intent:'create',plan:JSON.stringify(buildAiPlanSnapshot(plan)),schedule_items:null,created_at:new Date(Date.now()+1).toISOString()});state.activateAiPlan(plan);
const schedules=await import('../server/schedule-store.js'),activity=await import('../server/activity-store.js'),notifications=await import('../server/notification-chat.js'),reporting=await import('../server/activity-reports.js');
notifications.setInAppEnabled(uid,true);db.upsertReminder({...db.getReminder(uid)!,email_enabled:0,browser_enabled:1,quiet_hours_enabled:0});
const fixtures:Array<import('../server/schedule-store.js').Schedule>=[];
for(let i=0;i<15;i++){const created=new Date(Date.now()-(i%7)*86400000).toISOString(),due=new Date(Date.now()+(i-7)*3600000).toISOString();fixtures.push({id:'connected-fixture-'+i,user_id:uid,calendar_id:'personal',title:i===0?'超长事项标题用于核对个人活动报告的换行与原始对象定位'.repeat(5):'合成事项 '+i,type:i%3===0?'todo':'event',start_time:due,end_time:due,all_day:false,is_unscheduled:i%3===0,category:i%2?'work':'life',priority:'medium',is_completed:i%4===0,is_repeated:false,reminders:[],is_high_risk:false,created_at:created,updated_at:created});}
schedules.restoreUserScheduleData(uid,{schedules:fixtures},'merge');
for(const f of fixtures.filter(f=>f.is_completed))activity.createCompletion({userId:uid,sourceType:'schedule',sourceId:f.id,completedAt:new Date(Date.parse(f.created_at)+3600000).toISOString()});
const n=activity.enqueueNotificationDetailed({userId:uid,sourceType:'schedule',sourceId:'connected-fixture-1',channel:'in_app',kind:'due',title:'合成提醒',body:'查看事项、完成或延后。此卡片用于隔离环境交互验证。',scheduledAt:stamp,dedupeKey:'preview-notification'}).notification;notifications.deliverInApp(n);const browserNotice=activity.enqueueNotificationDetailed({userId:uid,sourceType:'schedule',sourceId:'connected-fixture-1',channel:'browser',kind:'due',title:'合成浏览器提醒',body:'AI 页面也应接收',scheduledAt:stamp,dedupeKey:'preview-browser-notification'}).notification;activity.markNotificationSent(browserNotice.id);
db.createNoteItem({id:'connected-note',user_id:uid,content:'普通正文可以编辑。参考链接 https://example.invalid/ 与 [内部事项](/schedule?schedule=connected-fixture-1)。',is_optimized:0,completed:0,created_at:stamp,updated_at:stamp});
// Mobile compact fixtures exercise occupied lists without any external content or calls.
for (let i=0;i<18;i++) db.createLibraryEntry({id:'mobile-library-'+i,user_id:uid,kind:i%3?'article':'fragment',type:i%2?'knowledge':'reference',source_id:'synthetic-'+i,slug:'synthetic-'+i,title:i===0?'长标题用于核对知识库卡片和阅读返回行为'.repeat(5):'合成知识 '+i,content:'# 合成正文\n\n用于隔离浏览器验收的内容，不是实际知识库数据。\n\n## 第二节\n\n阅读后返回列表。',summary:'移动端紧凑布局、筛选条件、列表位置与搜索跳转的合成内容。',tags_json:'["合成","验收"]',status:'active',source_type:'local',source_ref:null,source_url:null,metadata_json:'{}',relations_json:'[]',content_hash:'synthetic-'+i,created_at:new Date(Date.now()-i*86400000).toISOString(),updated_at:stamp,published_at:stamp,archived_at:null});
for (let i=0;i<10;i++) activity.createDailyReport({userId:uid,reportDate:new Date(Date.now()-i*86400000).toISOString().slice(0,10),source:'local',deliveryStatus:i===9?'candidate':'received',markdown:'# 合成日报 '+i+'\n\n这是移动布局和筛选验收内容。'+ '长摘要用于核对卡片和正文换行。'.repeat(12),contentHash:'synthetic-report-'+i});
reporting.setReportInsightGenerator(async()=>JSON.stringify({insights:[{text:'本期已有有效完成记录，建议从积压明细选择下一项。',metrics:['completed','backlog'],objects:[]}]}));
const app=express();app.use(api.app);app.use(express.static(path.resolve('dist')));app.get('*',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
const port=Number(process.argv[2]||4183),server=app.listen(port,'127.0.0.1',()=>console.log(`Isolated preview: http://127.0.0.1:${port}; synthetic login preview@example.invalid / OrbitPreview123!`));
process.on('SIGINT',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
