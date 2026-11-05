import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveQueryDates, resolveDraftDates, dateClarification } from './orbit-time.js';
import { parseDraftOutput, AI_DRAFT_SCHEMA } from './ai-chat-output.js';
import { AiExecutionError, aiErrorInfo, generateDraft } from './ai-execution.js';
import { chatToolNames, requestsScheduleDraft } from './ai-intent.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-chat-reliability-'));
Object.assign(process.env,{DATA_DIR:root,NODE_ENV:'test',APP_ENV:'development',BACKGROUND_JOBS_ENABLED:'false',ORBIT_PROACTIVE_ENABLED:'false',SMTP_PASS:'',IMAP_PASS:'',BACKUP_ENCRYPTION_KEY:'synthetic-only'});
const {consumeWorkBuddy,workBuddyOptions,workBuddyFailure}=await import('./ai-provider-workbuddy.js');
const api=await import('./index.js');await api.initializeServer();
assert.ok(fs.existsSync(path.join(root,'chat.db'))&&fs.existsSync(path.join(root,'activity.db')),'All initialized stores must use the isolated directory');
const db=await import('./db.js'),queue=await import('./orbit-queue.js'),store=await import('./orbit-store.js'),schedules=await import('./schedule-store.js');
const {queryAll,run}=await import('./database/connection.js');
const {workBuddyProvider}=await import('./ai-provider-workbuddy.js');
const {createOrbitTools}=await import('./orbit-tools.js');
const stamp=new Date().toISOString();
const user=db.createUser({id:'reliable-owner',email:'reliable@example.invalid',password_hash:'synthetic',role:'user',disabled:0,created_at:stamp,updated_at:stamp});
db.createUser({id:'reliable-other',email:'other@example.invalid',password_hash:'synthetic',role:'user',disabled:0,created_at:stamp,updated_at:stamp});
db.upsertUserApiKey({id:randomUUID(),user_id:user.id,api_key:'synthetic-only',base_url:null,created_at:stamp,updated_at:stamp});
const server=api.app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const base=`http://127.0.0.1:${(server.address() as any).port}`;
test.after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
const request=(url:string,body?:unknown)=>fetch(base+url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+api.signUserToken(user),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
async function settle(id:string){for(let i=0;i<600;i++){const row=store.getRequest(user.id,id)!;if(!['queued','running'].includes(row.state))return row;await new Promise(r=>setTimeout(r,20));}throw new Error('queue did not settle');}
async function send(text:string,cid=store.createConversation(user.id,'合成回归').id,targetDate='2026-10-22'){const id=randomUUID();const response=await request('/api/orbit/requests',{text,requestId:id,conversationId:cid,targetDate});assert.equal(response.status,202);return {id,cid,row:await settle(id)};}
const wire=JSON.stringify({intent:'create',reply:'待确认',operations:[{type:'create',data:{title:'合成活动',start_time:'2026-10-28T15:00:00',end_time:'2026-10-28T17:00:00',type:'event'}}]});

test('date parser ignores time ranges and validates leap dates, annotations and year ambiguity',()=>{
  for(const range of ['15:00-17:00','15:00–17:00','15:00至17:00']) assert.deepEqual(resolveQueryDates('10月28日（下周三）'+range+'举办活动','2026-10-22'),['2026-10-28']);
  assert.deepEqual(resolveQueryDates('15:00-17:00','2026-10-22'),['2026-10-22']);
  assert.deepEqual(resolveQueryDates('2026/10/28','2026-10-22'),['2026-10-28']);
  assert.equal(dateClarification('10月28日（下周三）举办活动','2026-10-22'),null);
  assert.match(dateClarification('10月28日（下周四）举办活动','2026-10-22')!,/不一致/);
  assert.match(dateClarification('准备1月2日活动','2026-12-31')!,/哪一年/);
  assert.match(dateClarification('2月29日活动','2026-01-01')!,/核对/);
  assert.match(dateClarification('明天10/28开会','2026-10-22')!,/不一致/);
  assert.match(dateClarification('2026-10-28 明天开会','2026-10-22')!,/不一致/);
  assert.equal(dateClarification('2月29日（周二）活动','2028-01-01'),null);
});
test('answer routes do not expose private tools or create drafts for date descriptions',()=>{
  assert.equal(requestsScheduleDraft('如何从0开始接入workbuddy'),false);
  assert.equal(requestsScheduleDraft('请生成日程草稿'),true);
  const names=chatToolNames('如何从0开始接入workbuddy',{product:false,schedule:false,knowledge:false,history:false});
  assert.deepEqual([...names],['search','read_url']);
  assert.deepEqual([...chatToolNames('如何从0开始接入workbuddy',{product:true,schedule:false,knowledge:false,history:false})],['settings','product_help','search','read_url']);
  assert.equal(chatToolNames('科比是谁',{product:false,schedule:false,knowledge:false,history:false}).size,0);
});
test('future scheduling rolls a bare weekday forward while explicit and read-only dates keep their meaning',()=>{
  assert.deepEqual(resolveDraftDates(['周一早上8点半报表'],'2026-11-01'),['2026-11-02']);
  assert.deepEqual(resolveDraftDates(['周日12点取卡'],'2026-11-01'),['2026-11-01']);
  assert.deepEqual(resolveDraftDates(['本周一报表'],'2026-11-01'),['2026-10-26']);
  assert.deepEqual(resolveDraftDates(['上周一报表'],'2026-11-01'),['2026-10-19']);
  assert.deepEqual(resolveQueryDates('周一有什么安排','2026-11-01'),['2026-10-26']);
  assert.deepEqual(resolveDraftDates(['其余三项12点','这是下周一的任务啊','周一早上8点半报表'],'2026-11-01'),['2026-11-02']);
  assert.deepEqual(resolveDraftDates(['改成11月4日','周一早上报表'],'2026-11-01'),['2026-11-04']);
  assert.deepEqual(resolveDraftDates(['改成11/4','周一早上报表'],'2026-11-01'),['2026-11-04']);
  assert.deepEqual(resolveDraftDates(['2026年11月9日（周一）8点报表'],'2026-11-01'),['2026-11-09']);
  assert.deepEqual(resolveDraftDates(['周一早上报表'],'2026-12-31'),['2027-01-04']);
});
test('SDK final failure, truncation and missing completion cannot use intermediate prose as success',async()=>{
  const req={userId:'x',model:'x',instructions:'',input:[],responseMode:'text' as const};
  const stream=async function*(ending:any){yield {type:'assistant',message:{content:[{type:'text',text:'intermediate'}],stop_reason:'tool_use'}};if(ending)yield ending;};
  for(const subtype of ['error_max_turns','error_during_execution','error_max_budget_usd'])await assert.rejects(consumeWorkBuddy(stream({type:'result',subtype,is_error:true,errors:['synthetic failure']}),req));
  await assert.rejects(consumeWorkBuddy(stream(null),req),/完成状态/);
  await assert.rejects(consumeWorkBuddy(stream({type:'result',subtype:'success',result:''}),req),/响应为空/);
  assert.equal(await consumeWorkBuddy((async function*(){yield {type:'result',subtype:'success',result:'多段\n\n```ts\nconst x="\\n";\n```'};})(),req),'多段\n\n```ts\nconst x="\\n";\n```');
  const structured={...req,responseMode:'draft' as const,outputSchema:AI_DRAFT_SCHEMA};
  assert.equal(JSON.parse(await consumeWorkBuddy((async function*(){yield {type:'result',subtype:'success',result:'bad',structured_output:JSON.parse(wire)};})(),structured)).reply,'待确认');
  assert.ok(workBuddyOptions(structured).outputFormat);
  await assert.rejects(workBuddyProvider.generate({...structured,userId:user.id}),error=>error instanceof AiExecutionError&&error.stage==='format'&&error.diagnostic?.param==='outputFormat');
  const sdkError=Object.assign(new Error('SDK throws before yielding result'),{name:'ExecutionError',subtype:'error_max_turns'});
  assert.equal((workBuddyFailure(sdkError) as AiExecutionError).code,'BUDGET');
  const broken='{"intent":"chat","reply":"raw\nnewline","operations":[]}';
  assert.equal(await consumeWorkBuddy((async function*(){yield {type:'result',subtype:'success',result:broken};})(),{...req,responseMode:'draft'}),broken);
});
test('model catalogue success is independent from generation authentication; malformed saved headers are rejected safely',async()=>{
  const {createModelService}=await import('./model-service.js');const {buildCodeBuddyEnv}=await import('./codebuddy-env.js');
  const credential={api_key:'合成非真实凭据',base_url:null};let catalogueEnv:Record<string,string>={};
  const service=createModelService<{modelId:string}>();
  const catalogue=await service.load({userId:'synthetic',credentialVersion:'v1',createSession:()=>{catalogueEnv=buildCodeBuddyEnv(credential);return {getAvailableModels:async()=>[{modelId:'glm-5.1'}],close:()=>{}};}});
  assert.equal(catalogue.length,1);const generationEnv=buildCodeBuddyEnv(credential);assert.equal(generationEnv.CODEBUDDY_API_KEY,catalogueEnv.CODEBUDDY_API_KEY);
  assert.throws(()=>new Headers({Authorization:'Bearer '+generationEnv.CODEBUDDY_API_KEY}),/ByteString/);
  const before=db.getUserApiKey(user.id)!.api_key;
  const ascii='ck_synthetic-only.not-a-real-key';const good=await request('/api/user-api-key',{apiKey:'  '+ascii+'  '});assert.equal(good.status,200);assert.equal(db.getUserApiKey(user.id)!.api_key,ascii);assert.equal(buildCodeBuddyEnv(db.getUserApiKey(user.id)!).CODEBUDDY_API_KEY,ascii);
  db.upsertUserApiKey({...db.getUserApiKey(user.id)!,api_key:before});
  const response=await request('/api/user-api-key',{apiKey:credential.api_key});assert.equal(response.status,400);assert.equal(db.getUserApiKey(user.id)!.api_key,before);
  assert.ok(!JSON.stringify(await response.json()).includes(credential.api_key));
  const {modelService}=await import('./ai-credentials.js');const load=modelService.load,generate=workBuddyProvider.generate;
  modelService.load=async()=>[{modelId:'glm-5.1'}];
  try{
    let probes=0;workBuddyProvider.generate=async req=>{probes++;assert.equal(req.responseMode,'text');assert.equal(req.tools?.length,0);return 'OK';};
    const verified=await(await request('/api/verify-api-key',{})).json();assert.equal(verified.verification,'generation');assert.equal(verified.authenticationVerified,true);assert.equal(probes,1);
    workBuddyProvider.generate=async()=>{throw new AiExecutionError('AUTH','synthetic invalid key');};const rejected=await request('/api/verify-api-key',{});assert.equal(rejected.status,401);assert.equal((await rejected.json()).valid,false);
    workBuddyProvider.generate=generate;
    db.upsertUserApiKey({...db.getUserApiKey(user.id)!,api_key:credential.api_key});
    const models=await(await request('/api/models')).json();assert.equal(models.models.length,1);
    const invalid=await request('/api/verify-api-key',{});assert.equal(invalid.status,400);assert.equal((await invalid.json()).code,'INVALID_KEY_FORMAT');
    const failed=await send('科比是谁');assert.equal(failed.row.state,'failed');assert.equal(store.requestExecution(failed.row).errorInfo?.code,'AUTH');
    assert.ok(!JSON.stringify(store.requestExecution(failed.row).errorInfo).includes(credential.api_key));
  }finally{modelService.load=load;workBuddyProvider.generate=generate;db.upsertUserApiKey({...db.getUserApiKey(user.id)!,api_key:before});}
});
test('draft validation repairs once without tools, explicit unsupported schema falls back without changing model',async()=>{
  let calls=0;const req={userId:'x',model:'same-model',instructions:'',input:[],responseMode:'draft' as const,outputSchema:AI_DRAFT_SCHEMA,tools:[{name:'x',description:'',schema:{},execute:async()=>({})}]};
  const output=await generateDraft(req,async r=>{calls++;if(calls===1)return '{"reply":"bad\nnewline"}';assert.equal(r.tools?.length,0);assert.equal(r.model,'same-model');return wire;},parseDraftOutput);
  assert.equal(calls,2);assert.equal(parseDraftOutput(output).operations.length,1);
  calls=0;await generateDraft(req,async r=>{calls++;if(calls===1)throw new AiExecutionError('MODEL_OUTPUT','json_schema unsupported','transport',{status:400,param:'text.format'});assert.equal(r.outputSchema,undefined);assert.equal(r.tools?.length,0);return calls===2?'bad':wire;},parseDraftOutput);assert.equal(calls,3);
  calls=0;await assert.rejects(generateDraft(req,async()=>{calls++;return 'bad';},parseDraftOutput));assert.equal(calls,2);
  assert.throws(()=>parseDraftOutput('{"intent":"chat","reply":"done","operations":[{"type":"delete","scheduleId":"x"}]}'));
});
test('same successful or failed tool arguments are executed once per run',async()=>{
  let steps=0;const tools=createOrbitTools({userId:user.id,timezone:'Asia/Hong_Kong',allowKnowledge:false,allowHistory:false,onStep:()=>steps++});
  const calendar=tools.tools.find(t=>t.name==='calendar')!;
  await Promise.all([calendar.execute({date:'2026-10-22'}),calendar.execute({date:'2026-10-22'})]);assert.equal(steps,2);
  await assert.rejects(calendar.execute({date:'bad'}));const after=steps;await assert.rejects(calendar.execute({date:'bad'}));assert.equal(steps,after);
});
test('three screenshot inputs use text/clarification/advice routes; only explicit followup creates an unconfirmed draft',async()=>{
  const original=workBuddyProvider.generate;let calls=0;
    workBuddyProvider.generate=async req=>{calls++;if(req.responseMode==='draft')return wire;assert.equal(req.outputSchema,undefined);if(req.input[0].text==='科比是谁'){assert.equal(req.tools?.length,0);return '科比是篮球运动员。\n\n**多段落**与 `代码`、"引号"、\\反斜杠。';}assert.ok(req.tools?.every(t=>['settings','product_help','search','read_url'].includes(t.name)));assert.match(req.instructions,/默认理解为接入当前 Orbit/);assert.match(req.instructions,/用户明确指定其他目标时/);assert.match(req.input[0].text!,/Orbit 资料/);return 'Orbit 已有 WorkBuddy 接入，请在个人 API Key 中配置并测试连接。';};
  try{
    const a=await send('科比是谁');assert.equal(a.row.state,'completed');assert.match(JSON.parse(a.row.result!).reply,/多段落/);
    const b=await send('10月28日（下周三）15:00-17:00举办活动');assert.equal(b.row.state,'completed');assert.match(JSON.parse(b.row.result!).reply,/2026-10-28 15:00-17:00/);assert.equal(calls,1);
    const before=schedules.getAllSchedules(user.id).length;
    const c=await send('请生成日程草稿',b.cid);assert.equal(JSON.parse(c.row.result!).requiresConfirmation,true);assert.equal(schedules.getAllSchedules(user.id).length,before);
    const d=await send('如何从0开始接入workbuddy');assert.equal(d.row.state,'completed');assert.equal(calls,3);
    const views=await(await request('/api/orbit/requests?conversationId='+a.cid)).json();assert.equal(views.requests[0].responseMessageId,JSON.parse(a.row.result!).historyMessageId);assert.ok(views.requests[0].startedAt);
  }finally{workBuddyProvider.generate=original;}
});
test('multi-turn date and time clarification reaches the strict draft protocol without writing schedules',async()=>{
  const original=workBuddyProvider.generate;
  const activity='周一早上8点半报表，周一早上做统计，周一中午取卡，周一提醒同事上线小程序';
  let calls=0;
  workBuddyProvider.generate=async req=>{
    calls++;assert.equal(req.responseMode,'draft');assert.ok(req.outputSchema);assert.match(req.instructions,/2026-11-02/);
    assert.match(req.instructions,/承接当前对话/);assert.doesNotMatch(req.instructions,/本轮只回答或查询/);
    if(calls===1)return JSON.stringify({intent:'chat',reply:'后三项时间需要补充，请确认是否按12点。',operations:[],warnings:[]});
    assert.match(req.instructions,/周一早上8点半报表/);
    return JSON.stringify({intent:'create',reply:'四项草稿待确认。',operations:['报表','做统计','取卡','提醒同事'].map((title,i)=>({type:'create',data:{title,start_time:`2026-11-02T${i===0?'08:30':'12:00'}:00`,type:'todo'}}))});
  };
  try{
    const before=schedules.getAllSchedules(user.id).length;
    const first=await send(activity,undefined,'2026-11-01');assert.match(JSON.parse(first.row.result!).reply,/2026-11-02/);assert.equal(calls,0);
    const correction=await send('这是下周一的任务啊',first.cid,'2026-11-01');assert.equal(correction.row.state,'completed');assert.equal(calls,1);
    const final=await send('单独建一条新的，后三项时间就按12点来',first.cid,'2026-11-01');
    const result=JSON.parse(final.row.result!);assert.equal(final.row.state,'completed');assert.equal(result.requiresConfirmation,true);assert.equal(result.plan.operations.length,4);
    assert.deepEqual(result.plan.operations.map((op:any)=>op.startTime),['2026-11-02T08:30:00','2026-11-02T12:00:00','2026-11-02T12:00:00','2026-11-02T12:00:00']);
    assert.equal(schedules.getAllSchedules(user.id).length,before);
    assert.equal(calls,2);
    workBuddyProvider.generate=async req=>{assert.equal(req.responseMode,'text');return '普通回答';};
    const unrelated=await send('好的');assert.equal(JSON.parse(unrelated.row.result!).requiresConfirmation,undefined);
    const other=await send('讲个笑话',store.createConversation(user.id,'新话题边界').id,'2026-11-01');
    const next=await send('好的',other.cid,'2026-11-01');assert.equal(JSON.parse(next.row.result!).requiresConfirmation,undefined);
  }finally{workBuddyProvider.generate=original;}
});
test('followup cannot borrow draft intent from attachments, notifications, failures, expired turns or finished plans',async()=>{
  const original=workBuddyProvider.generate;
  workBuddyProvider.generate=async req=>{assert.equal(req.responseMode,'text');return '普通答复';};
  try{
    for(const blocked of ['attachment','notification','failed','expired','plan']){
      const cid=store.createConversation(user.id,'边界-'+blocked).id;
      const body={text:'周一早上8点半报表',...(blocked==='attachment'?{attachmentIds:['synthetic-only']}:{}),...(blocked==='notification'?{notificationId:'synthetic-only'}:{})};
      const result={intent:'chat',reply:'请补充时间。',...(blocked==='plan'?{requiresConfirmation:true}:{})};
      run('INSERT INTO orbit_requests(id,user_id,conversation_id,state,body,result,created_at) VALUES (?,?,?,?,?,?,?)',[randomUUID(),user.id,cid,blocked==='failed'?'failed':'completed',JSON.stringify(body),JSON.stringify(result),new Date(Date.now()-(blocked==='expired'?31*60_000:1000)).toISOString()]);
      const next=await send('好的',cid);assert.equal(next.row.state,'completed',blocked);assert.equal(JSON.parse(next.row.result!).requiresConfirmation,undefined,blocked);
    }
  }finally{workBuddyProvider.generate=original;}
});
test('preprocessing and output failures have one safe request error, retry increments attempt and removes prior steps',async()=>{
  const original=workBuddyProvider.generate;workBuddyProvider.generate=async()=>{throw new AiExecutionError('MODEL_OUTPUT','Bad control character; synthetic private reply');};
  try{
    const {row,id,cid}=await send('科比是谁');assert.equal(row.state,'failed');assert.ok(!row.error?.includes('synthetic'));
    assert.equal(queryAll('SELECT id FROM ai_schedule_messages WHERE user_id=? AND conversation_id=? AND type=?',[user.id,cid,'error']).length,0);
    run('INSERT INTO orbit_request_steps(user_id,request_id,id,label,state,at) VALUES (?,?,?,?,?,?)',[user.id,id,'old','old','failed',stamp]);
    workBuddyProvider.generate=async()=> '恢复回答';await request('/api/orbit/requests/'+id+'/retry',{});const next=await settle(id);assert.equal(next.state,'completed');assert.equal(store.requestExecution(next).attempt,2);assert.equal(queryAll('SELECT id FROM orbit_request_steps WHERE user_id=? AND request_id=?',[user.id,id]).length,0);
    assert.equal(queryAll('SELECT id FROM ai_schedule_messages WHERE user_id=? AND conversation_id=? AND role=?',[user.id,cid,'user']).length,1);
    workBuddyProvider.generate=async()=>'';assert.equal(store.requestExecution((await send('科比是谁')).row).errorInfo?.code,'MODEL_OUTPUT');
  }finally{workBuddyProvider.generate=original;}
});
test('partial evidence survives continuation, freezes input, is owner scoped and creates one child without another user message',async()=>{
  const original=workBuddyProvider.generate;
  workBuddyProvider.generate=async req=>{req.onEvidence?.({tool:'read_url',args:{url:'https://example.org/'},data:'公开合成资料'});throw new AiExecutionError('BUDGET','Max turns (4) exceeded');};
  try{
    const {id,cid,row}=await send('如何从0开始接入workbuddy');assert.equal(row.state,'partial');assert.ok(store.requestExecution(row).evidence?.length);
    assert.throws(()=>queue.continueOrbitRequest('reliable-other',id,randomUUID()),/不存在/);
    workBuddyProvider.generate=async req=>{assert.equal(req.responseMode,'text');assert.match(req.input[0].text!,/公开合成资料/);assert.match(req.instructions,/2026-10-22/);return '继续后的完整说明';};
    const childId=randomUUID();const response=await request('/api/orbit/requests/'+id+'/continue',{requestId:childId});assert.equal(response.status,202);assert.equal((await settle(childId)).state,'completed');
    assert.equal(queue.continueOrbitRequest(user.id,id,childId).id,childId);assert.equal(queue.continueOrbitRequest(user.id,id,randomUUID()).id,childId);
    assert.equal(queryAll('SELECT id FROM ai_schedule_messages WHERE user_id=? AND conversation_id=? AND role=?',[user.id,cid,'user']).length,1);
    const views=await(await request('/api/orbit/requests?conversationId='+cid)).json();assert.equal(views.requests.find((r:any)=>r.id===id).canContinue,false);
  }finally{workBuddyProvider.generate=original;}
});
test('cancel during draft repair prevents late messages and plans',async()=>{
  const original=workBuddyProvider.generate;let calls=0,started!:()=>void,release!:()=>void;
  const entered=new Promise<void>(r=>started=r),blocked=new Promise<void>(r=>release=r);
  workBuddyProvider.generate=async()=>{if(++calls===1)return 'bad';started();await blocked;return wire;};
  const cid=store.createConversation(user.id,'取消恢复').id,id=randomUUID();
  try{await request('/api/orbit/requests',{text:'创建明天的会议',conversationId:cid,requestId:id});await entered;queue.cancelOrbitRequest(user.id,id);release();await new Promise(r=>setTimeout(r,50));assert.equal(store.getRequest(user.id,id)?.state,'cancelled');assert.equal(queryAll('SELECT id FROM ai_schedule_messages WHERE user_id=? AND conversation_id=? AND role=?',[user.id,cid,'assistant']).length,0);}
  finally{release();workBuddyProvider.generate=original;}
});
test('final persistence failure cannot acknowledge or retain a successful assistant message',async()=>{
  const original=workBuddyProvider.generate,rename=fs.renameSync;let rejected=false;
  workBuddyProvider.generate=async()=>{fs.renameSync=((from,to)=>{if(!rejected&&String(to)===path.join(root,'chat.db')){rejected=true;throw new Error('synthetic final persistence failure');}return rename(from,to);}) as typeof fs.renameSync;return '不得保留的成功回答';};
  try{const {row,cid}=await send('科比是谁');assert.equal(row.state,'failed');assert.equal(rejected,true);assert.equal(queryAll('SELECT id FROM ai_schedule_messages WHERE user_id=? AND conversation_id=? AND role=?',[user.id,cid,'assistant']).length,0);}
  finally{fs.renameSync=rename;workBuddyProvider.generate=original;}
});

test('inactivity uses the last human or AI message, ignores notifications, and freezes the cutoff on retry', async () => {
  const { resolveOrbitRound } = await import('./orbit-round.js');
  const cid = store.createConversation(user.id, '合成分轮').id;
  const now = Date.now();
  const older = new Date(now - 31 * 60_000).toISOString();
  const replyAt = new Date(now - 30 * 60_000).toISOString();
  const seed = (role: 'user' | 'assistant', content: string, at: string, meta?: unknown) => {
    const id = randomUUID();
    db.createAiScheduleMessage({ id, user_id: user.id, conversation_id: cid, role, type: 'text', content, intent: null, plan: null,
      schedule_items: role === 'assistant' ? JSON.stringify([{ id: 'old-item', title: '旧事项编号' }]) : null,
      knowledge_sources: role === 'assistant' ? JSON.stringify([{ id: 'old-source' }]) : null, created_at: at });
    if (meta) run('UPDATE ai_schedule_messages SET orbit_meta=? WHERE user_id=? AND id=?', [JSON.stringify(meta), user.id, id]);
    return id;
  };
  const oldUser = seed('user', '旧话题隐私标记', older);
  const { uploadChatAttachment, linkMessageAttachments, selectAttachmentIds } = await import('./orbit-attachments.js');
  const attachment = await uploadChatAttachment(user.id, cid, {
    name: '旧轮资料.txt', mime: 'text/plain', base64: Buffer.from('旧轮附件内容').toString('base64'),
  });
  linkMessageAttachments(user.id, oldUser, [attachment.id]);
  seed('assistant', '旧模型回复', replyAt);
  seed('assistant', '系统通知', new Date(now - 10_000).toISOString(), { origin: 'notification' });
  assert.equal(resolveOrbitRound(user.id, cid, new Date(now - 60_000)), '');
  assert.equal(resolveOrbitRound(user.id, cid, new Date(now)), new Date(now).toISOString());
  const original = workBuddyProvider.generate;
  try {
    workBuddyProvider.generate = async req => {
      assert.doesNotMatch(req.instructions, /旧话题隐私标记|旧模型回复|系统通知|旧事项编号|old-source/);
      throw new AiExecutionError('MODEL_OUTPUT', '合成首次失败');
    };
    const first = await send('请回答一个新问题', cid);
    assert.equal(first.row.state, 'failed');
    const cutoff = store.requestExecution(first.row).roundStartedAt!;
    assert.ok(cutoff);
    assert.deepEqual(store.recentObjectReferences(user.id, cid, cutoff), []);
    assert.deepEqual(store.previousKnowledgeIds(user.id, cid, cutoff), []);
    assert.deepEqual(selectAttachmentIds(user.id, cid, '上一张图是什么？', [], cutoff), []);
    assert.deepEqual(selectAttachmentIds(user.id, cid, '请看这个附件', [attachment.id], cutoff), [attachment.id]);
    seed('assistant', '旧轮迟到回复', new Date().toISOString(), { roundStartedAt: '' });
    workBuddyProvider.generate = async req => {
      assert.doesNotMatch(req.instructions, /旧轮迟到回复|旧话题隐私标记/);
      await new Promise(resolve => setTimeout(resolve, 35));
      return '新轮回复';
    };
    assert.equal((await request('/api/orbit/requests/' + first.id + '/retry', {})).status, 200);
    const retried = await settle(first.id);
    assert.equal(retried.state, 'completed');
    assert.equal(store.requestExecution(retried).roundStartedAt, cutoff);
    const { messages } = await (await request('/api/ai-schedule/history?conversationId=' + cid)).json();
    assert.ok(messages.some((message: any) => message.text === '旧模型回复'));
    assert.equal(messages.filter((message: any) => message.orbitMeta?.newRoundAt === cutoff).length, 1);
    assert.ok(messages.find((message: any) => message.text === '新轮回复').orbitMeta.processingMs >= 30);
    assert.equal(messages.find((message: any) => message.text === '旧模型回复').orbitMeta?.processingMs, undefined);
    const next = await send('再接着说一件事', cid);
    assert.equal(store.requestExecution(next.row).roundStartedAt, cutoff);
  } finally { workBuddyProvider.generate = original; }
});

test('quick replies verify the original prompt and round, then discuss or create only a pending plan', async () => {
  const { orbitQuickReplies } = await import('../src/utils/orbit-quick-reply.js');
  const original = workBuddyProvider.generate;
  const activity = '10月28日（下周三）15:00-17:00举办活动';
  try {
    const draft = await send(activity);
    const discuss = await send(activity);
    const stale = await send(activity);
    const messageId = (result: typeof draft) => JSON.parse(result.row.result!).historyMessageId;
    const submit = (cid: string, id: string, choice: keyof typeof orbitQuickReplies, requestId = randomUUID()) =>
      request('/api/orbit/requests', { text: orbitQuickReplies[choice], requestId, conversationId: cid, quickReply: { messageId: id, choice } });
    const before = schedules.getAllSchedules(user.id).length;
    assert.equal((await submit(discuss.cid, messageId(draft), 'draft')).status, 400);
    const oldAt = new Date(Date.now() - 31 * 60_000).toISOString();
    run('UPDATE orbit_requests SET created_at=? WHERE user_id=? AND conversation_id=?', [oldAt, user.id, stale.cid]);
    run('UPDATE ai_schedule_messages SET created_at=? WHERE user_id=? AND conversation_id=?', [oldAt, user.id, stale.cid]);
    const expired = await submit(stale.cid, messageId(stale), 'draft');
    assert.equal(expired.status, 400);
    assert.match((await expired.json()).error, /已过期.*重新描述/);

    workBuddyProvider.generate = async req => {
      assert.match(req.input[0].text!, /原问题.*举办活动/);
      if (req.responseMode === 'draft') {
        assert.match(req.instructions, /2026-10-28/);
        return wire;
      }
      assert.match(req.instructions, /已选择先讨论/);
      return '先讨论活动需要准备哪些材料。';
    };
    const draftId = randomUUID();
    assert.equal((await submit(draft.cid, messageId(draft), 'draft', draftId)).status, 202);
    assert.equal(JSON.parse((await settle(draftId)).result!).requiresConfirmation, true);
    assert.equal((await submit(draft.cid, messageId(draft), 'draft', draftId)).status, 202);
    assert.equal((await submit(draft.cid, messageId(draft), 'discuss')).status, 400);
    const discussId = randomUUID();
    assert.equal((await submit(discuss.cid, messageId(discuss), 'discuss', discussId)).status, 202);
    const result = JSON.parse((await settle(discussId)).result!);
    assert.match(result.reply, /讨论活动/);
    assert.equal(result.requiresConfirmation, undefined);
    assert.equal(schedules.getAllSchedules(user.id).length, before);
  } finally { workBuddyProvider.generate = original; }
});
