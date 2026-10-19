import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-round3-'));
Object.assign(process.env, { DATA_DIR: root, NODE_ENV: 'test', APP_ENV: 'development', BACKGROUND_JOBS_ENABLED: 'false', ORBIT_PROACTIVE_ENABLED: 'false', JWT_SECRET: 'synthetic-round3-only' });
const api = await import('./index.js'); await api.initializeServer();
const db = await import('./db.js'), orbit = await import('./orbit-store.js');
const { run, queryOne } = await import('./database/connection.js');
const { chatTimelinePage } = await import('./chat-timeline.js');
const { activityReportChatText } = await import('./activity-report-chat.js');
const reports = await import('./activity-reports.js'), activity = await import('./activity-store.js'), chat = await import('./notification-chat.js');
const stamp = new Date().toISOString();
for (const id of ['round3-owner', 'round3-other']) db.createUser({ id, email: id+'@example.invalid', password_hash: 'synthetic', role: 'user', disabled: 0, created_at: stamp, updated_at: stamp });
const owner = 'round3-owner', cid = orbit.ensureDefaultConversation(owner);

test('combined history pages retain orphan failures beyond 40, stable retries, identical times and ownership', () => {
  for (let i=0; i<125; i++) {
    const id = `r${String(i).padStart(3,'0')}`, at = new Date(Date.parse(stamp)+Math.floor(i/4)*1000).toISOString();
    run('INSERT INTO orbit_requests (id,user_id,conversation_id,state,body,created_at) VALUES (?,?,?,?,?,?)', [id, owner, cid, i%2?'interrupted':'failed', JSON.stringify({text:id}), at]);
    if(i%3) db.createAiScheduleMessage({id:`orbit-user:${owner}:${id}`,user_id:owner,conversation_id:cid,role:'user',type:'text',content:id,intent:null,schedule_items:null,plan:null,created_at:at});
  }
  const first = chatTimelinePage(owner,cid,{limit:60}); assert.equal(first.entries.length,60); assert.ok(first.nextBefore);
  const loaded = [...first.entries]; let cursor: string | null = first.nextBefore;
  while(cursor) { const page=chatTimelinePage(owner,cid,{limit:60,before:cursor}); loaded.unshift(...page.entries); cursor=page.nextBefore; }
  assert.equal(new Set(loaded.map(e=>e.kind+e.id)).size,loaded.length); assert.equal(loaded.filter(e=>e.kind==='request').length,125);
  const r0 = loaded.findIndex(e=>e.kind==='request'&&e.id==='r000'); assert.ok(r0>=0);
  run("UPDATE orbit_requests SET state='queued' WHERE user_id=? AND id='r000'",[owner]);
  const refreshed=chatTimelinePage(owner,cid,{limit:60,after:Buffer.from(JSON.stringify([loaded[0].at,loaded[0].kind,loaded[0].id])).toString('base64url')});
  assert.deepEqual(refreshed.entries.map(e=>e.kind+e.id),loaded.map(e=>e.kind+e.id));
  const lateAt=new Date(Date.parse(stamp)+999000).toISOString(),lateId='late-boundary';
  run('INSERT INTO orbit_requests (id,user_id,conversation_id,state,body,created_at) VALUES (?,?,?,?,?,?)',[lateId,owner,cid,'queued',JSON.stringify({text:'late'}),lateAt]);
  const boundary=chatTimelinePage(owner,cid,{limit:1});assert.equal(boundary.entries[0].kind,'request');
  db.createAiScheduleMessage({id:`orbit-user:${owner}:${lateId}`,user_id:owner,conversation_id:cid,role:'user',type:'text',content:'late',intent:null,schedule_items:null,plan:null,created_at:new Date(Date.parse(lateAt)+1000).toISOString()});
  assert.ok(chatTimelinePage(owner,cid,{limit:1,after:boundary.start}).entries.some(entry=>entry.id===`orbit-user:${owner}:${lateId}`));
  assert.deepEqual(chatTimelinePage('round3-other',cid,{limit:60}).entries,[]); assert.throws(()=>chatTimelinePage(owner,cid,{before:'invalid'}));
});

test('known weekly notices use owned snapshot title links, preserve stored history and do not expose raw IDs', async () => {
  chat.setInAppEnabled(owner,true);
  const report=reports.createActivityReport(owner,{period:'week'}), notice=activity.enqueueNotificationDetailed({userId:owner,sourceType:'activity_report',sourceId:report.id,channel:'in_app',kind:'weekly_report',title:'Orbit Weekly',body:reports.renderActivityReport(report),scheduledAt:stamp,dedupeKey:'round3-weekly'}).notification;
  const messageId=chat.deliverInApp(notice)!;
  const clean=activityReportChatText(owner,report.id); assert.match(clean,/\[查看完整报告\]\(\/project/); assert.ok(!clean.includes('报告 ID：')); assert.ok(!clean.includes('http://'));
  assert.equal(activityReportChatText('round3-other',report.id),'个人活动报告已移除或无法访问。');
  const original=`旧记录 报告 ID：${report.id}\nhttp://example.invalid/raw`; run('UPDATE ai_schedule_messages SET content=? WHERE user_id=? AND id=?',[original,owner,messageId]);
  const server=api.app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  try { const base=`http://127.0.0.1:${(server.address() as any).port}`, headers={Authorization:'Bearer '+api.signUserToken(db.getUserById(owner)!)};
    const result=await (await fetch(base+'/api/ai-schedule/history?conversationId='+cid,{headers})).json();
    assert.match(result.messages.find((m:any)=>m.id===messageId).text,/查看完整报告/);
    assert.equal(queryOne<{content:string}>('SELECT content FROM ai_schedule_messages WHERE id=?',[messageId])!.content,original);
    const paged=await (await fetch(base+'/api/ai-schedule/history?conversationId='+cid+'&limit=10',{headers})).json(); assert.ok(paged.messages.length+paged.requests.length<=10); assert.ok(paged.nextBefore);
    const other={Authorization:'Bearer '+api.signUserToken(db.getUserById('round3-other')!)}; assert.equal((await fetch(base+'/api/ai-schedule/history?conversationId='+cid+'&limit=10',{headers:other})).status,400);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
