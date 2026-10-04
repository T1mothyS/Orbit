import { getNotification } from './activity-store.js';
import { getUserById, getReminder, getUserPreferredModel } from './db.js';
import { defaultModel } from './ai-credentials.js';
import { chatGPTStatus } from './chatgpt-connection.js';
import { dateInZone } from './orbit-time.js';
import { queryAll, run } from './database/connection.js';
import { conversation, getRequest, orbitContext, type ChatRequest } from './orbit-store.js';
import { aiChatRequestRecords, isAiChatRequestId } from './ai-chat-state.js';
import { withPersistenceTransaction } from './persistence.js';
import {validateChatAttachments} from './orbit-attachments.js';
type Worker = (req: any, res: any) => Promise<any>;
let worker: Worker;
const active = new Map<string, {
    id: string;
    controller: AbortController;
}>();
export function setOrbitWorker(value: Worker) { const previous = worker; worker = value; return previous; }
export function recoverOrbitQueue() {
    run("UPDATE orbit_requests SET state='interrupted',error='服务重启中断了生成，请重试' WHERE state='running'");
    for (const row of queryAll<{
        user_id: string;
    }>("SELECT DISTINCT user_id FROM orbit_requests WHERE state='queued'"))
        void pump(row.user_id);
}
export function submitOrbitRequest(userId: string, body: any) {
    const id = String(body.requestId || '');
    const cid = String(body.conversationId || '');
    if (!isAiChatRequestId(id))
        throw new Error('请求编号不正确');
    conversation(userId, cid);
    const text = String(body.text || '').trim();
    if (!text || text.length > 20000)
        throw new Error('请输入 1–20000 字的内容');
    const allowed = new Set(['text', 'requestId', 'conversationId', 'targetDate', 'model', 'calendarId', 'knowledgeScope', 'provider','attachmentIds','notificationId']);
    if(body.notificationId!==undefined&&(typeof body.notificationId!=='string'||!getNotification(body.notificationId,userId)))throw new Error('通知不存在或无权访问');
    const attachmentIds=validateChatAttachments(userId,cid,body.attachmentIds||[]);
    if(body.provider!==undefined && !['workbuddy','chatgpt'].includes(body.provider))throw new Error('Provider 当前不可用');
    if(body.provider==='chatgpt' && (!chatGPTStatus(userId).connected || !body.model))throw new Error('请连接 ChatGPT 并选择该账号可用模型');
    if (Object.keys(body).some(key => !allowed.has(key)))
        throw new Error('请求包含不支持的字段');
    const old = getRequest(userId, id);
    if (old) {
        const frozen=JSON.parse(old.body);
        if (old.conversation_id !== cid || frozen.text !== text || (body.provider!==undefined&&frozen.provider!==body.provider) || (body.model!==undefined&&frozen.model!==body.model) || JSON.stringify(frozen.attachmentIds||[])!==JSON.stringify(attachmentIds))
            throw new Error('请求编号已用于其他内容');
        return old;
    }
    if (queryAll("SELECT id FROM orbit_requests WHERE user_id=? AND state IN ('queued','running')", [userId]).length >= 20)
        throw new Error('等待队列已满，请先处理已有请求');
    const submittedAt = new Date();
    const targetDate = body.targetDate || dateInZone(submittedAt, getReminder(userId)?.timezone || 'Asia/Shanghai');
    run('INSERT INTO orbit_requests (id,user_id,conversation_id,state,body,created_at) VALUES (?,?,?,?,?,?)', [id, userId, cid, 'queued', JSON.stringify({ ...body, text, targetDate,attachmentIds, provider:body.provider||'workbuddy',model:body.model||getUserPreferredModel(userId,defaultModel) }), submittedAt.toISOString()]);
    void pump(userId);
    return getRequest(userId, id)!;
}
export function cancelOrbitRequest(userId: string, id: string) {
    const row = getRequest(userId, id);
    if (!row)
        throw new Error('请求不存在');
    if (['queued', 'running'].includes(row.state)) {
        run("UPDATE orbit_requests SET state='cancelled',error='已取消' WHERE id=? AND user_id=?", [id, userId]);
        if (active.get(userId)?.id === id)
            active.get(userId)!.controller.abort();
    }
    return getRequest(userId, id)!;
}
export function listOrbitRequests(userId: string, cid: string) { conversation(userId, cid); void pump(userId); return queryAll<ChatRequest>('SELECT * FROM orbit_requests WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 40', [userId, cid]).reverse(); }
export function retryOrbitRequest(userId: string, id: string) {
    const row = getRequest(userId, id);
    if (!row)
        throw new Error('请求不存在');
    conversation(userId, row.conversation_id);
    if (active.get(userId)?.id === id)
        throw new Error('取消操作正在结束，请稍后重试');
    if (!['failed', 'interrupted', 'cancelled'].includes(row.state))
        return row;
    aiChatRequestRecords.delete(`${userId}:${id}`);
    run("UPDATE orbit_requests SET state='queued',error=NULL,result=NULL WHERE user_id=? AND id=?", [userId, id]);
    void pump(userId);
    return getRequest(userId, id)!;
}
async function pump(userId: string) {
    if (active.has(userId) || !worker)
        return;
    const row = queryAll<ChatRequest>("SELECT * FROM orbit_requests WHERE user_id=? AND state='queued' ORDER BY created_at,rowid LIMIT 1", [userId])[0];
    if (!row)
        return;
    const controller = new AbortController();
    active.set(userId, { id: row.id, controller });
    run("UPDATE orbit_requests SET state='running' WHERE id=? AND user_id=?", [row.id, userId]);
    let status = 200, result: any;
    const res: any = { status: (code: number) => { status = code; return res; }, json: (data: any) => { result = data; return res; } };
    const timeout = setTimeout(() => controller.abort(), 300000);
    try {
        const account = getUserById(userId);
        if (!account || account.disabled)
            throw new Error('账号不可用');
        conversation(userId, row.conversation_id);
        await orbitContext.run({ userId, conversationId: row.conversation_id, requestId: row.id, controller }, () => worker({ user: { userId }, body: JSON.parse(row.body) }, res));
        if (!getRequest(userId, row.id) || getRequest(userId, row.id)?.state === 'cancelled')
            return;
        if (controller.signal.aborted)
            throw new Error('生成已中断');
        if (status >= 400 || !result)
            throw new Error(result?.error || 'AI 未返回结果');
        withPersistenceTransaction(() => run("UPDATE orbit_requests SET state='completed',result=?,error=NULL WHERE id=? AND user_id=?", [JSON.stringify(result), row.id, userId]));
    }
    catch (error) {
        if (getRequest(userId, row.id)?.state !== 'cancelled')
            run("UPDATE orbit_requests SET state='failed',error=? WHERE id=? AND user_id=?", [controller.signal.aborted ? '生成超时，请重试' : error instanceof Error ? error.message : '生成失败', row.id, userId]);
    }
    finally {
        clearTimeout(timeout);
        active.delete(userId);
        void pump(userId);
    }
}
