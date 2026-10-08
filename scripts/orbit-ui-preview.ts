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
const {settingsActions,settingAction}=await import('../src/utils/navigation-actions.js');
const helpMessage='synthetic-product-help';
db.createAiScheduleMessage({id:helpMessage,user_id:uid,conversation_id:cid,role:'assistant',type:'text',content:'合成产品帮助：可以打开日报设置、知识库设置或个人资料。',intent:'chat',plan:null,schedule_items:null,created_at:stamp});
run('UPDATE ai_schedule_messages SET orbit_meta=? WHERE id=?',[JSON.stringify({actions:[...settingsActions('日报关注行业'),settingAction('settings-library'),settingAction('library-personal-preferences'),{type:'navigate',target:'settings.general',settingId:'unknown',label:'不应执行的入口'}],settingRefs:[{id:'android-push-enabled',label:'旧通知设置入口'}]}),helpMessage]);
run('INSERT INTO orbit_proactive_events (id,user_id,schedule_id,expected_state,trigger_at,state,message_id,created_at,handled_action,handled_at) VALUES (?,?,?,?,?,?,?,?,?,?)',[event,uid,'preview-finished','synthetic',stamp,'handled',message,stamp,'complete',stamp]);
db.createAiScheduleMessage({id:message,user_id:uid,conversation_id:cid,role:'assistant',type:'text',content:'资料已核对完成。',intent:null,plan:null,schedule_items:null,created_at:stamp,orbit_meta:JSON.stringify({origin:'proactive',eventId:event,enhanced:false})});
run('UPDATE ai_schedule_messages SET orbit_meta=? WHERE id=?',[JSON.stringify({origin:'proactive',eventId:event,enhanced:false}),message]);
const plan:import('../server/ai-chat-state.js').PendingAiSchedulePlan={id:randomUUID(),userId:uid,conversationId:cid,targetCalendarId:'personal',today:new Date().toISOString().slice(0,10),intent:'create',reply:'已准备三个待办草稿，请确认。',warnings:[],revision:1,state:'pending',expiresAt:Date.now()+900000,historyMessageId:randomUUID(),operations:['合成待办甲','合成待办乙','合成待办丙'].map((title,i)=>({key:String(i),type:'create',data:{title,type:'todo',is_unscheduled:true}}))};
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
for (let i=0;i<18;i++) db.createLibraryEntry({id:'mobile-library-'+i,user_id:uid,kind:i%3?'article':'fragment',type:i%2?'knowledge':'reference',source_id:'synthetic-'+i,slug:'synthetic-'+i,title:i===0?'长标题用于核对知识库卡片和阅读返回行为'.repeat(5):'合成知识 '+i,content:'# 合成正文\n\n用于隔离浏览器验收的内容，不是实际知识库数据。\n\n'+Array.from({length:12},(_,section)=>`## 第 ${section+1} 节\n\n${'用于验证阅读滚动、章节定位和顶部遮挡的合成段落。'.repeat(35)}\n\n`).join(''),summary:'移动端紧凑布局、筛选条件、列表位置与搜索跳转的合成内容。',tags_json:'["合成","验收"]',status:'active',source_type:'local',source_ref:null,source_url:null,metadata_json:'{}',relations_json:'[]',content_hash:'synthetic-'+i,created_at:new Date(Date.now()-i*86400000).toISOString(),updated_at:stamp,published_at:stamp,archived_at:null});
for (let i=0;i<10;i++) activity.createDailyReport({userId:uid,reportDate:new Date(Date.now()-i*86400000).toISOString().slice(0,10),source:'local',deliveryStatus:i===9?'candidate':'received',markdown:'# 合成日报 '+i+'\n\n这是移动布局和筛选验收内容。'+ '长摘要用于核对卡片和正文换行。'.repeat(12),contentHash:'synthetic-report-'+i});
reporting.setReportInsightGenerator(async()=>JSON.stringify({insights:[{text:'本期已有有效完成记录，建议从积压明细选择下一项。',metrics:['completed','backlog'],objects:[]}]}));
if(process.argv.includes('--iteration')) {
  const cloud=await import('../server/daily-report-cloud-store.js');
  cloud.saveDailyReportCloudContext(uid,{
    profile:{identity:{language:'zh-CN',timezone:'Asia/Hong_Kong'},background:{career_context:'合成职业背景'},professional_interests:['合成专业兴趣'],research_projects:[],information_preferences:{answer_style:['说明依据']}},
    preferences:{prefer:['保留证据'],avoid:['凑数'],target_reading_time_minutes:10,evidence_policy:['来源核验']},
    recent_interests:{topics:[]},watchlist:{sectors:[],stocks:[{name:'合成公司',symbol:'TEST',priority:'high',sectors:[],thesis_file:'theses/fixture.yaml'}],companies:[]},
    theses:{fixture:{name:'合成公司',symbol:'TEST',priority:'high',status:'active',thesis:{one_liner:'合成研究框架'}}},extension:{preserved:true},
  },0);
  const rich=['---','sourceId: synthetic-reader','title: 合成阅读样本','---','# 长标题阅读验证'+ '标题'.repeat(20),'',
    '这是含有**粗体**、`行内代码`与长链接的正文：[来源](/'+ 'long-link-'.repeat(40)+')。','',
    '## 列表与引用','','- 第一项','- 第二项','','> 保留知识文章的引用结构。','','![合成图示](/orbit-logo.png)','','## 代码与表格','','```typescript',
    'const longLine = "'+ 'long-code-'.repeat(40)+'";','```','','| 第一列 | 第二列 | 第三列 |','| --- | --- | --- |','| '+ '内容'.repeat(30)+' | 长表格 | 可横向滚动 |','',
    '## 数学与图示','','\\[','\\sum_{i=1}^{100} x_i^2 = y','\\]','','```mermaid','flowchart TD','A[阅读] --> B[核对证据]','B --> C[明确确认]','```','',
    '## 后续段落','',...Array.from({length:8},(_,i)=>`### 第${i+1}段\n\n${'用于核对字号、段落、滚动和定位的合成文字。'.repeat(12)}\n\n`)].join('\n');
  const {createHash}=await import('node:crypto');
  db.createLibraryEntry({id:'iteration-reader',user_id:uid,kind:'article',type:'knowledge',source_id:'synthetic-reader',slug:'synthetic-reader',title:'知识库长标题阅读样本'.repeat(6),content:rich,summary:'合成阅读验收',tags_json:'["合成"]',status:'active',source_type:'local',source_ref:null,source_url:null,metadata_json:'{}',relations_json:'[]',content_hash:createHash('sha256').update(rich).digest('hex'),created_at:stamp,updated_at:stamp,published_at:stamp,archived_at:null});
  db.upsertUserApiKey({id:randomUUID(),user_id:uid,api_key:'synthetic-preview-only',base_url:null,created_at:stamp,updated_at:stamp});
  const queue=await import('../server/orbit-queue.js');
  queue.setOrbitWorker(async(req,res)=>{
    const selected=req.body.notificationId?notifications.notificationContinuation(uid,req.body.notificationId):undefined;
    state.saveAiScheduleHistoryMessage({userId:uid,role:'user',type:'text',content:req.body.text});
    await new Promise(resolve=>setTimeout(resolve,1200));
    const result={success:true,intent:'chat',reply:selected?`合成回应：已明确关联“${selected.title}”。`:'合成回应：普通对话。'};
    const saved=state.saveAiScheduleResponseHistory(uid,result);res.json({...result,historyMessageId:saved.id});
  });
}
const app=express();
if(process.argv.includes('--iteration')) {
  // Synthetic readiness must not cause SDK login/model discovery on this preview.
  app.get('/api/models',(_req,res)=>res.json({models:[{modelId:'glm-5.1',displayName:'合成 WorkBuddy 模型'}],defaultModel:'glm-5.1'}));
  app.get('/api/check-login',(_req,res)=>res.json({isLoggedIn:true}));
}
app.use(api.app);app.use(express.static(path.resolve('dist')));app.get('*',(_req,res)=>res.sendFile(path.resolve('dist/index.html')));
const port=Number(process.argv[2]||4183),server=app.listen(port,'127.0.0.1',()=>console.log(`Isolated preview: http://127.0.0.1:${port}; synthetic login preview@example.invalid / OrbitPreview123!`));
process.on('SIGINT',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
