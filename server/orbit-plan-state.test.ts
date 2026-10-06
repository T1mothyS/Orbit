import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbit-plan-state-'));
Object.assign(process.env,{DATA_DIR:root,NODE_ENV:'test',APP_ENV:'development',BACKGROUND_JOBS_ENABLED:'false',ORBIT_PROACTIVE_ENABLED:'false',BACKUP_ENCRYPTION_KEY:'synthetic-only'});
const api=await import('./index.js');await api.initializeServer();
const db=await import('./db.js'),store=await import('./orbit-store.js'),state=await import('./ai-chat-state.js');
const {buildAiPlanSnapshot}=await import('./ai-plan.js');
const {queryOne}=await import('./database/connection.js');
const schedules=await import('./schedule-store.js');
const stamp=new Date().toISOString();
for(const id of ['plan-owner','plan-other']) db.createUser({id,email:`${id}@example.invalid`,password_hash:'synthetic',role:'user',disabled:0,created_at:stamp,updated_at:stamp});
function draft(cid=store.ensureDefaultConversation('plan-owner')) {
  const plan:import('./ai-chat-state.js').PendingAiSchedulePlan={id:randomUUID(),userId:'plan-owner',conversationId:cid,targetCalendarId:'personal',today:'2026-10-03',intent:'create',reply:'待确认',warnings:[],revision:1,state:'pending',expiresAt:Date.now()+900000,operations:[{key:'0',type:'create',data:{title:'开会',start_time:'2026-10-04T09:00:00',end_time:'2026-10-04T10:30:00'}}]};
  plan.historyMessageId=randomUUID();db.createAiScheduleMessage({id:plan.historyMessageId,user_id:plan.userId,conversation_id:cid,role:'assistant',type:'plan',content:plan.reply,intent:'create',plan:JSON.stringify(buildAiPlanSnapshot(plan)),schedule_items:null,created_at:stamp});state.activateAiPlan(plan);return plan;
}
test('9 to 10 revises same owned durable draft, preserves duration, anchor, revision and no writes',()=>{
  const p=draft();state.aiSchedulePlans.clear();
  const r=state.pendingInteraction('plan-owner',p.conversationId!,'改成十点');assert.equal(r.plan?.id,p.id);assert.equal(r.plan?.operations[0].data.start_time,'2026-10-04T10:00:00');assert.equal(r.plan?.operations[0].data.end_time,'2026-10-04T11:30:00');assert.equal(r.plan?.revision,2);
  assert.equal(state.resolveAiPlan('plan-other',p.id),undefined);assert.equal(state.pendingInteraction('plan-owner',p.conversationId!,'确认').handled,true);
  assert.throws(()=>state.assertPlanRevision(r.plan!,1),/已更新/);
  const friday=state.pendingInteraction('plan-owner',p.conversationId!,'换到下周五');assert.equal(friday.plan?.operations[0].data.start_time,'2026-10-09T10:00:00');
  assert.equal(schedules.getAllSchedules('plan-owner').length,0);
});
test('new topic suspends, separate conversations independent, resume explicit, cancellation clears pointer',()=>{
  const p=draft();assert.equal(state.pendingInteraction('plan-owner',p.conversationId!,'请帮我解释一下相对论').handled,false);assert.equal(state.resolveAiPlan('plan-owner',p.id)?.state,'suspended');assert.equal(state.activeAiPlan('plan-owner',p.conversationId!),undefined);
  const second=draft(store.createConversation('plan-owner','second').id);assert.equal(state.activeAiPlan('plan-owner',second.conversationId!)?.id,second.id);
  state.activateAiPlan(state.resolveAiPlan('plan-owner',p.id)!);state.pendingInteraction('plan-owner',p.conversationId!,'还是算了');assert.equal(state.resolveAiPlan('plan-owner',p.id)?.state,'cancelled');assert.equal(queryOne<any>('SELECT active_plan_message_id FROM orbit_conversations WHERE id=?',[p.conversationId])?.active_plan_message_id,null);
});
test('expired drafts cannot execute after cache clearing, backup restore never activates them',()=>{
  const p=draft();p.expiresAt=Date.now()-1;state.persistAiPlan(p);state.aiSchedulePlans.clear();assert.equal(state.resolveAiPlan('plan-owner',p.id)?.state,'expired');assert.throws(()=>state.assertPlanRevision(state.resolveAiPlan('plan-owner',p.id)!,1),/不可执行/);
  const current=draft();const backup=store.exportOrbit('plan-owner');store.restoreOrbit('plan-owner',backup,'replace');assert.equal(state.resolveAiPlan('plan-owner',current.id)?.state,'suspended');
});
test('HTTP confirm restores without reading history, rejects stale revision and replays without duplication',async()=>{
  const p=draft(store.createConversation('plan-owner','HTTP').id);
  const server=api.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const req=(body:unknown)=>fetch(base+'/api/ai-chat/confirm',{method:'POST',headers:{Authorization:'Bearer '+api.signUserToken(db.getUserById('plan-owner')!), 'Content-Type':'application/json'},body:JSON.stringify(body)});
  try {
    state.reviseAiPlan(p,0,{startTime:'2026-10-04T10:00:00'},1);state.aiSchedulePlans.clear();
    assert.equal((await req({planId:p.id,expectedRevision:1})).status,409);
    const res=await req({planId:p.id,expectedRevision:2});assert.equal(res.status,200);const result=await res.json();assert.equal(result.changedDetails.created.length,1);
    assert.deepEqual(await (await req({planId:p.id,expectedRevision:2})).json(),result);
    assert.equal(state.resolveAiPlan('plan-owner',p.id)?.state,'completed');
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
test('partial retry contains only failed operations and replays the same new draft',()=>{const p=draft();p.operations.push({key:'1',type:'create',data:{title:'失败项',start_time:'invalid'}});p.state='partially_completed';p.result={changed:true,changedDetails:{failures:[{index:1}]}};state.persistAiPlan(p);const next=state.retryFailedPlan(p);assert.equal(next.operations.length,1);assert.equal(next.operations[0].data.title,'失败项');assert.notEqual(next.id,p.id);assert.equal(state.retryFailedPlan(state.resolveAiPlan('plan-owner',p.id)!).id,next.id);assert.equal(state.activeAiPlan('plan-owner',cidFor(next))?.id,next.id);});
function cidFor(p:import('./ai-chat-state.js').PendingAiSchedulePlan){return p.conversationId!;}

test('removing draft creates persists revisions, protects ownership and executes only remaining items', async () => {
  const p = draft(store.createConversation('plan-owner', 'remove HTTP').id);
  p.operations.push({key:'1',type:'create',data:{title:'保留待办',type:'todo',is_unscheduled:true}});
  state.persistAiPlan(p);
  const server = api.app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const request = (key:string, revision:unknown, owner='plan-owner') => fetch(`${base}/api/ai-chat/plans/${p.id}/operations/${key}`, {
    method:'DELETE',headers:{Authorization:'Bearer '+api.signUserToken(db.getUserById(owner)!), 'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:revision}),
  });
  try {
    assert.equal((await request('0',1,'plan-other')).status,404);
    assert.equal((await request('0',undefined)).status,400);
    const removed = await request('0',1); assert.equal(removed.status,200);
    const next = (await removed.json()).plan;
    assert.equal(next.revision,2); assert.equal(next.operations.length,1);
    assert.equal(next.operations[0].key,'0'); assert.equal(next.operations[0].title,'保留待办');
    assert.equal((await request('0',1)).status,409);
    state.aiSchedulePlans.clear();
    const durable = state.resolveAiPlan('plan-owner',p.id)!;
    assert.equal(durable.operations.length,1); assert.equal(durable.revision,2);
    state.reviseAiPlan(durable,0,{title:'保留并编辑的待办'},2);
    const confirmed = await fetch(base+'/api/ai-chat/confirm',{method:'POST',headers:{Authorization:'Bearer '+api.signUserToken(db.getUserById('plan-owner')!), 'Content-Type':'application/json'},body:JSON.stringify({planId:p.id,expectedRevision:3})});
    assert.equal(confirmed.status,200);
    const result = await confirmed.json();
    assert.deepEqual(result.changedDetails.created.map((item:any)=>item.title),['保留并编辑的待办']);
    assert.equal(result.changedDetails.created[0].is_unscheduled,true);
    assert.equal((await request('0',4)).status,409);
  } finally { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); }
});

test('last draft removal survives cache reset, clears active pointer and cannot execute', () => {
  const p = draft();
  const count = schedules.getAllSchedules('plan-owner').length;
  const next = state.removeAiPlanOperation(p,0,1);
  assert.equal(next.state,'cancelled'); assert.equal(next.operations.length,0);
  assert.equal(state.activeAiPlan('plan-owner',p.conversationId!),undefined);
  state.aiSchedulePlans.clear();
  const restored = state.resolveAiPlan('plan-owner',p.id)!;
  assert.equal(restored.state,'cancelled'); assert.equal(restored.revision,2);
  assert.throws(()=>state.assertPlanRevision(restored,2),/不可执行/);
  assert.equal(schedules.getAllSchedules('plan-owner').length,count);
  const expired = draft(); expired.expiresAt=Date.now()-1; state.persistAiPlan(expired);
  assert.throws(()=>state.removeAiPlanOperation(state.resolveAiPlan('plan-owner',expired.id)!,0,1),/不可执行/);
  const update = draft(); update.operations[0].type='update'; state.persistAiPlan(update);
  assert.throws(()=>state.removeAiPlanOperation(update,0,1),/只能移除待创建/);
});

test('failed persistence retains the complete pending draft', () => {
  const p=draft(), rename=fs.renameSync;
  let rejected=false;
  fs.renameSync=((from:fs.PathLike,to:fs.PathLike)=>{
    if(!rejected && String(to)===path.join(root,'chat.db')) { rejected=true; throw new Error('synthetic write failure'); }
    return rename(from,to);
  }) as typeof fs.renameSync;
  try { assert.throws(()=>state.removeAiPlanOperation(p,0,1),/synthetic write failure/); }
  finally { fs.renameSync=rename; }
  assert.equal(rejected,true); state.aiSchedulePlans.clear();
  const restored=state.resolveAiPlan('plan-owner',p.id)!;
  assert.equal(restored.state,'pending'); assert.equal(restored.operations.length,1); assert.equal(restored.revision,1);
});
