import { getNotification } from './activity-store.js';
import { getUserById, getReminder, getUserPreferredModel } from './db.js';
import { defaultModel } from './ai-credentials.js';
import { chatGPTStatus } from './chatgpt-connection.js';
import { dateInZone } from './orbit-time.js';
import { queryAll, run } from './database/connection.js';
import { conversation, getRequest, orbitContext, requestExecution, type ChatRequest } from './orbit-store.js';
import { AiExecutionError, aiErrorInfo, boundedEvidence, type AiEvidence } from './ai-execution.js';
import { addLog } from './log-service.js';
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
        void pump(row.user_id).catch(error=>addLog('error','ai','AI 队列恢复失败',{code:aiErrorInfo(error).code}));
}
export function submitOrbitRequest(userId: string, body: any, parent?: ChatRequest) {
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
        if (old.conversation_id !== cid || frozen.text !== text || (frozen.notificationId || null) !== (body.notificationId || null) || (body.provider!==undefined&&frozen.provider!==body.provider) || (body.model!==undefined&&frozen.model!==body.model) || JSON.stringify(frozen.attachmentIds||[])!==JSON.stringify(attachmentIds))
            throw new Error('请求编号已用于其他内容');
        return old;
    }
    if (queryAll("SELECT id FROM orbit_requests WHERE user_id=? AND state IN ('queued','running')", [userId]).length >= 20)
        throw new Error('等待队列已满，请先处理已有请求');
    const submittedAt = new Date();
    const targetDate = body.targetDate || dateInZone(submittedAt, getReminder(userId)?.timezone || 'Asia/Shanghai');
    const inherited=parent?requestExecution(parent):{};
    const meta={attempt:0,timezone:inherited.timezone||getReminder(userId)?.timezone||'Asia/Shanghai',...(parent?{continuationOf:parent.id,rootRequestId:inherited.rootRequestId||parent.id,evidence:inherited.evidence}: {})};
    run('INSERT INTO orbit_requests (id,user_id,conversation_id,state,body,created_at,execution_meta) VALUES (?,?,?,?,?,?,?)', [id, userId, cid, 'queued', JSON.stringify({ ...body, text, targetDate,attachmentIds, provider:body.provider||'workbuddy',model:body.model||getUserPreferredModel(userId,defaultModel) }), submittedAt.toISOString(),JSON.stringify(meta)]);
    void pump(userId).catch(error=>addLog('error','ai','AI 队列持久化失败',{requestId:active.get(userId)?.id,code:aiErrorInfo(error).code}));
    return getRequest(userId, id)!;
}
export function continueOrbitRequest(userId:string,id:string,requestId:string) {
    if(!isAiChatRequestId(requestId))throw new Error('请求编号不正确');
    const parent=getRequest(userId,id);if(!parent)throw new Error('请求不存在');
    conversation(userId,parent.conversation_id);
    const same=getRequest(userId,requestId);
    if(same){if(requestExecution(same).continuationOf!==id)throw new Error('请求编号已用于其他内容');return same;}
    const child=queryAll<ChatRequest>('SELECT * FROM orbit_requests WHERE user_id=? AND conversation_id=?',[userId,parent.conversation_id]).find(row=>requestExecution(row).continuationOf===id);
    if(child)return child;
    if(parent.state!=='partial'||!requestExecution(parent).evidence?.length)throw new Error('该请求没有可继续的有效资料');
    return submitOrbitRequest(userId,{...JSON.parse(parent.body),requestId},parent);
}
export function recordRequestEvidence(userId:string,id:string,item:AiEvidence) {
    const row=getRequest(userId,id);if(!row||row.state!=='running')return;
    const meta=requestExecution(row),rows=meta.evidence||[];
    const key=JSON.stringify([item.tool,item.args]);const index=rows.findIndex(r=>JSON.stringify([r.tool,r.args])===key);
    if(index>=0)rows[index]=item;else rows.push(item);
    run('UPDATE orbit_requests SET execution_meta=? WHERE user_id=? AND id=?',[JSON.stringify({...meta,evidence:boundedEvidence(rows)}),userId,id]);
}
export function replaceRequestEvidence(userId:string,id:string,evidence:AiEvidence[]) {
    const row=getRequest(userId,id);if(!row||row.state!=='running')return;
    run('UPDATE orbit_requests SET execution_meta=? WHERE user_id=? AND id=?',[JSON.stringify({...requestExecution(row),evidence:boundedEvidence(evidence)}),userId,id]);
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
export function listOrbitRequests(userId: string, cid: string) { conversation(userId, cid); void pump(userId).catch(error=>addLog('error','ai','AI 队列持久化失败',{requestId:active.get(userId)?.id,code:aiErrorInfo(error).code})); return queryAll<ChatRequest>('SELECT * FROM orbit_requests WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 40', [userId, cid]).reverse(); }
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
    const meta=requestExecution(row);delete meta.errorInfo;delete meta.startedAt;delete meta.responseMessageId;meta.evidence=meta.continuationOf?requestExecution(getRequest(userId,meta.continuationOf)||{}).evidence:[];
    withPersistenceTransaction(()=>{
        run('DELETE FROM orbit_request_steps WHERE user_id=? AND request_id=?',[userId,id]);
        run("UPDATE orbit_requests SET state='queued',error=NULL,result=NULL,execution_meta=? WHERE user_id=? AND id=?", [JSON.stringify(meta),userId, id]);
    });
    void pump(userId).catch(error=>addLog('error','ai','AI 队列持久化失败',{requestId:active.get(userId)?.id,code:aiErrorInfo(error).code}));
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
    const meta=requestExecution(row);Object.assign(meta,{attempt:(meta.attempt||0)+1,startedAt:new Date().toISOString()});

    let status = 200, result: any;
    const res: any = { status: (code: number) => { status = code; return res; }, json: (data: any) => {
        result = data;
        if(status<400){controller.signal.throwIfAborted();const live=getRequest(userId,row.id);if(!live||live.state==='cancelled')throw new AiExecutionError('CANCELLED','生成已取消');
            withPersistenceTransaction(()=>run("UPDATE orbit_requests SET state='completed',result=?,error=NULL,execution_meta=? WHERE id=? AND user_id=?",[JSON.stringify(data),JSON.stringify({...requestExecution(live),responseMessageId:data.historyMessageId}),row.id,userId]));}
        return res;
    } };
    const timeout = setTimeout(() => controller.abort(), 300000);
    try {
    run("UPDATE orbit_requests SET state='running',execution_meta=? WHERE id=? AND user_id=?", [JSON.stringify(meta),row.id, userId]);
        const account = getUserById(userId);
        if (!account || account.disabled)
            throw new Error('账号不可用');
        conversation(userId, row.conversation_id);
        await orbitContext.run({ userId, conversationId: row.conversation_id, requestId: row.id, controller,timezone:meta.timezone,rootRequestId:meta.rootRequestId,continuationOf:meta.continuationOf }, () => worker({ user: { userId }, body: JSON.parse(row.body) }, res));
        if (!getRequest(userId, row.id) || getRequest(userId, row.id)?.state === 'cancelled')
            return;
        if (controller.signal.aborted)
            throw new Error('生成已中断');
        if (status >= 400 || !result)
            throw new Error(result?.error || 'AI 未返回结果');
        // res.json commits the result with its final message. Do not persist a second
        // success after that atomic commit: a redundant write could falsely fail it.
    }
    catch (error) {
        aiChatRequestRecords.delete(`${userId}:${row.id}`);
        const live=getRequest(userId,row.id);
        if(live&&live.state!=='cancelled'){
            const failure=controller.signal.aborted?new AiExecutionError('NETWORK','生成超时','request'):error;
            const info=aiErrorInfo(failure,row.id),current=requestExecution(live),partial=info.code==='BUDGET'&&!!current.evidence?.length;
            const response=partial?{partial:true,reply:error instanceof AiExecutionError&&error.partialReply?error.partialReply:'已取得部分资料，尚未完成。可以展开资料查看或继续查询。',evidence:current.evidence}:null;
            run('UPDATE orbit_requests SET state=?,error=?,result=?,execution_meta=? WHERE id=? AND user_id=?',[partial?'partial':'failed',info.message,response?JSON.stringify(response):null,JSON.stringify({...current,errorInfo:info}),row.id,userId]);
            addLog('error','ai','AI 请求未完成',{requestId:row.id,attempt:current.attempt,provider:JSON.parse(row.body).provider,model:JSON.parse(row.body).model,code:info.code,stage:info.stage,diagnostic:failure instanceof AiExecutionError?failure.diagnostic:undefined,cause:failure});
        }
    }
    finally {
        clearTimeout(timeout);
        active.delete(userId);
        void pump(userId).catch(error=>addLog('error','ai','AI 队列持久化失败',{requestId:active.get(userId)?.id,code:aiErrorInfo(error).code}));
    }
}
