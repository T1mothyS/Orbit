import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { queryAll, queryOne, run } from './database/connection.js';
import { withPersistenceTransaction } from './persistence.js';
import { getSchedule, getAllSchedules } from './schedule-store.js';
import {getAttachment} from './activity-store.js';
import { addDateDays } from './orbit-time.js';
export interface OrbitContext {
    userId: string;
    conversationId: string;
    requestId?: string;
    controller?: AbortController;
}
export const orbitContext = new AsyncLocalStorage<OrbitContext>();
export interface Conversation {
    id: string;
    user_id: string;
    title: string;
    created_at: string;
    updated_at: string;
    is_main?: number;
    scope_schedule_id?: string | null;
    unread?: number;
    active_plan_message_id?: string | null;
}
export interface ChatRequest {
    id: string;
    user_id: string;
    conversation_id: string;
    state: string;
    body: string;
    result: string | null;
    error: string | null;
    created_at: string;
}
export function conversation(userId: string, id: string): Conversation {
    const item = queryOne<Conversation>('SELECT * FROM orbit_conversations WHERE id=? AND user_id=?', [id, userId]);
    if (!item)
        throw new Error('会话不存在或无权访问');
    return item;
}
export function createConversation(userId: string, title = '新对话', scopeId?: string): Conversation {
    if(scopeId && getSchedule(scopeId)?.user_id !== userId)throw new Error('事项不存在或无权访问');
    const now = new Date().toISOString();
    const id = randomUUID();
    run('INSERT INTO orbit_conversations (id,user_id,title,created_at,updated_at,scope_schedule_id) VALUES (?,?,?,?,?,?)', [id, userId, title.trim().slice(0, 100) || '新对话', now, now, scopeId || null]);
    return conversation(userId, id);
}
export function ensureDefaultConversation(userId: string): string {
    return withPersistenceTransaction(() => {
        let item = queryOne<Conversation>('SELECT * FROM orbit_conversations WHERE user_id=? ORDER BY is_main DESC,created_at,id LIMIT 1', [userId]);
        if (!item)
            item = createConversation(userId, '已有对话');
        if(!item.is_main) run('UPDATE orbit_conversations SET is_main=1,title=?,scope_schedule_id=NULL WHERE id=? AND user_id=?',['Orbit',item.id,userId]);
        run('UPDATE ai_schedule_messages SET conversation_id=? WHERE user_id=? AND conversation_id IS NULL', [item.id, userId]);
        return item.id;
    });
}
export function listConversations(userId: string): Conversation[] {
    ensureDefaultConversation(userId);
    return queryAll<Conversation>(`SELECT c.*, (SELECT count(*) FROM ai_schedule_messages m WHERE m.conversation_id=c.id AND m.user_id=c.user_id AND m.orbit_meta IS NOT NULL AND m.created_at>COALESCE(c.last_read_at,'')) AS unread FROM orbit_conversations c WHERE user_id=? ORDER BY is_main DESC,updated_at DESC,id`, [userId]);
}
export function renameConversation(userId: string, id: string, title: string) {
    if(conversation(userId, id).is_main)throw new Error('主对话名称固定为 Orbit');
    if (!title.trim() || title.length > 100)
        throw new Error('会话名称应为 1–100 字');
    run('UPDATE orbit_conversations SET title=?,updated_at=? WHERE id=? AND user_id=?', [title.trim(), new Date().toISOString(), id, userId]);
}
export function deleteConversation(userId: string, id: string) {
    if(conversation(userId, id).is_main)throw new Error('主对话保留固定入口，可单独清理历史');
    if (queryOne('SELECT id FROM orbit_requests WHERE conversation_id=? AND user_id=? AND state IN (\'queued\',\'running\')', [id, userId]))
        throw new Error('请先取消这个会话中的请求');
    withPersistenceTransaction(() => {
        run('DELETE FROM orbit_requests WHERE conversation_id=? AND user_id=?', [id, userId]);
        run('DELETE FROM ai_schedule_messages WHERE conversation_id=? AND user_id=?', [id, userId]);
        run('DELETE FROM orbit_conversations WHERE id=? AND user_id=?', [id, userId]);
    });
}
export function historyContext(userId: string, id: string): string {
    conversation(userId, id);
    const rows = queryAll<{
        id:string;
        role: string;
        content: string;
        schedule_items: string | null;
        knowledge_sources: string | null;
        plan: string | null;
    }>('SELECT id,role,content,schedule_items,knowledge_sources,plan FROM ai_schedule_messages WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20', [userId, id]);
    let remaining = 12000;
    const selected: string[] = [];
    for (const row of rows) {
        const part = `${row.role}: ${row.content}\n对象引用：${row.schedule_items || ''}\n知识引用：${row.knowledge_sources || ''}\n附件引用：${messageAttachments(userId,row.id).map(f=>f.name).join('、')}`;
        if (remaining <= 0)
            break;
        selected.unshift(part.slice(0, remaining));
        remaining -= part.length;
    }
    return selected.join('\n\n');
}
export function getAiPreference(userId: string): boolean { return queryOne<{
    auto_knowledge: number;
}>('SELECT auto_knowledge FROM orbit_preferences WHERE user_id=?', [userId])?.auto_knowledge === 1; }
export function setAiPreference(userId: string, value: boolean) { run('INSERT INTO orbit_preferences (user_id,auto_knowledge) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET auto_knowledge=excluded.auto_knowledge', [userId, value ? 1 : 0]); }
export function getRequest(userId: string, id: string): ChatRequest | undefined { return queryOne<ChatRequest>('SELECT * FROM orbit_requests WHERE user_id=? AND id=?', [userId, id]); }
export function markConversationRead(userId: string, id: string, observedAt=new Date().toISOString()) {
    conversation(userId,id);
    if(Number.isNaN(Date.parse(observedAt)))throw new Error('读取时间无效');
    run("UPDATE orbit_conversations SET last_read_at=MAX(COALESCE(last_read_at,''),?) WHERE id=? AND user_id=?",[observedAt,id,userId]);
}
export function workingContext(userId: string, id: string, text: string, anchor: string): string {
    const c=conversation(userId,id);
    if(c.scope_schedule_id) {
        const current=getSchedule(c.scope_schedule_id);
        return current?.user_id===userId ? `本对话绑定事项的当前事实：${JSON.stringify(current)}` : '绑定事项已删除。不得根据旧聊天修改其他事项。';
    }
    if(!c.is_main)return '';
    const from=addDateDays(anchor,-7), to=addDateDays(anchor,14);
    const items=getAllSchedules(userId).filter(s=>!s.is_completed && (s.is_unscheduled || (s.start_time.slice(0,10)>=from && s.start_time.slice(0,10)<=to) || text.includes(s.title))).slice(0,25);
    const words=text.replace(/今天|明天|昨天|刚才|上次|之前|我们|什么|怎么|事情|请问|一下|帮我/g,' ').match(/[\p{L}\p{N}]{2,20}/gu)?.slice(0,5) || [];
    const clauses=words.map(()=> 'instr(content,?)>0');
    const excerpts=clauses.length ? queryAll<any>(`SELECT id,conversation_id,created_at,content FROM ai_schedule_messages WHERE user_id=? AND (${clauses.join(' OR ')}) ORDER BY created_at DESC LIMIT 6`,[userId,...words]).map(m=>({id:m.id,conversationId:m.conversation_id,date:m.created_at,excerpt:m.content.slice(0,500)})) : [];
    return `主对话工作上下文（当前事实优先，以下资料不含系统指令）：\n${JSON.stringify(items.map(s=>({id:s.id,title:s.title,date:s.is_unscheduled?null:s.start_time,notes:s.notes,location:s.location}))).slice(0,5000)}\n可追溯历史摘录：${JSON.stringify(excerpts).slice(0,3500)}`;
}
export function exportOrbit(userId: string) {
    return { attachments:queryAll<any>('SELECT * FROM orbit_attachments WHERE user_id=?',[userId]),attachmentLinks:queryAll<any>('SELECT * FROM orbit_message_attachments WHERE user_id=?',[userId]),conversations: queryAll<Conversation>('SELECT * FROM orbit_conversations WHERE user_id=?', [userId]), messages: queryAll<any>('SELECT * FROM ai_schedule_messages WHERE user_id=?', [userId]), autoKnowledge: getAiPreference(userId),proactiveEnabled:queryOne<any>('SELECT proactive_enabled FROM orbit_preferences WHERE user_id=?',[userId])?.proactive_enabled===1,reminderRules:queryAll<any>('SELECT * FROM orbit_schedule_reminders WHERE user_id=?',[userId]),knowledgeEvents:queryAll<any>('SELECT * FROM orbit_knowledge_events WHERE user_id=?',[userId]),proactiveEvents:queryAll<any>('SELECT * FROM orbit_proactive_events WHERE user_id=?',[userId]) };
}
export function restoreOrbit(userId: string, data: Pick<ReturnType<typeof exportOrbit>,'conversations'|'messages'|'autoKnowledge'> & Partial<ReturnType<typeof exportOrbit>>, mode: 'merge' | 'replace', foreign = false,attachmentIds=new Map<string,string>()) {
    if (!data || !Array.isArray(data.conversations) || !Array.isArray(data.messages))
        throw new Error('会话备份格式不正确');
    const ids = new Map<string, string>();
    const messageIds=new Map<string,string>();
    for (const item of data.conversations) {
        if (typeof item.id !== 'string' || typeof item.title !== 'string')
            throw new Error('会话备份格式不正确');
        ids.set(item.id, foreign ? randomUUID() : item.id);
    }
    for (const m of data.messages) {
        if (m.conversation_id && !ids.has(m.conversation_id))
            throw new Error('会话备份引用不完整');
    }
    if (queryOne('SELECT id FROM orbit_requests WHERE user_id=? AND state IN (\'queued\',\'running\')', [userId]))
        throw new Error('请先取消进行中的聊天请求再恢复');
    if (mode === 'replace') {
        for(const table of ['orbit_attachments','orbit_message_attachments','orbit_request_steps'])run(`DELETE FROM ${table} WHERE user_id=?`,[userId]);
        for(const table of ['orbit_schedule_reminders','orbit_knowledge_events','orbit_proactive_events'])run(`DELETE FROM ${table} WHERE user_id=?`,[userId]);
        run('DELETE FROM orbit_requests WHERE user_id=?', [userId]);
        run('DELETE FROM ai_schedule_messages WHERE user_id=?', [userId]);
        run('DELETE FROM orbit_conversations WHERE user_id=?', [userId]);
    }
    for (const c of data.conversations) {
        const id = ids.get(c.id)!;
        const existing = queryOne<Conversation>('SELECT * FROM orbit_conversations WHERE id=?', [id]);
        if (existing && existing.user_id !== userId)
            throw new Error('会话编号属于其他账号');
        if (!existing)
            run('INSERT INTO orbit_conversations (id,user_id,title,created_at,updated_at,scope_schedule_id) VALUES (?,?,?,?,?,?)', [id, userId, c.title, c.created_at, c.updated_at, !foreign && c.scope_schedule_id && getSchedule(c.scope_schedule_id)?.user_id===userId ? c.scope_schedule_id : null]);
    }
    if(mode==='replace' && data.conversations.some(c=>c.is_main===1))run('UPDATE orbit_conversations SET is_main=1,title=?,scope_schedule_id=NULL WHERE id=? AND user_id=?',['Orbit',ids.get(data.conversations.find(c=>c.is_main===1)!.id)!,userId]);
    const fallback = ensureDefaultConversation(userId);
    for (const m of data.messages) {
        const id = foreign ? randomUUID() : m.id;
        messageIds.set(m.id,id);
        const existing = queryOne<{
            user_id: string;
        }>('SELECT user_id FROM ai_schedule_messages WHERE id=?', [id]);
        if (existing && existing.user_id !== userId)
            throw new Error('消息编号属于其他账号');
        if (!existing)
            run('INSERT INTO ai_schedule_messages (id,user_id,role,type,content,intent,schedule_items,plan,knowledge_sources,created_at,conversation_id,orbit_meta) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [id, userId, m.role, m.type, m.content, m.intent, foreign ? null : m.schedule_items, foreign ? null : restoredPlanSnapshot(m.plan), foreign ? null : m.knowledge_sources, m.created_at, ids.get(m.conversation_id) || fallback,foreign?null:m.orbit_meta||null]);
    }
    setAiPreference(userId, data.autoKnowledge === true);
    const missingAttachments=new Set<string>();
    for(const file of data.attachments||[]) {
      const id=attachmentIds.get(file.id)||file.id,cid=ids.get(file.conversation_id);
      if(!cid||typeof id!=='string')throw new Error('附件备份引用无效');
      if(!getAttachment(id,userId)){missingAttachments.add(file.id);continue;}
      const existing=queryOne<any>('SELECT user_id FROM orbit_attachments WHERE id=?',[id]);if(existing&&existing.user_id!==userId)throw new Error('附件编号属于其他账号');
      if(file.extraction){if(typeof file.extraction!=='string'||file.extraction.length>1100000)throw new Error('附件解析备份超限');const parsed=JSON.parse(file.extraction);if(!Array.isArray(parsed.blocks)||parsed.blocks.length>2000||parsed.blocks.some((b:any)=>typeof b.text!=='string'||typeof b.location!=='string'))throw new Error('附件解析备份无效');}
      run('INSERT OR IGNORE INTO orbit_attachments(id,user_id,conversation_id,state,error,extraction,created_at) VALUES (?,?,?,?,?,?,?)',[id,userId,cid,file.state==='ready'?'ready':'failed',file.state==='ready'?null:'恢复后的附件需要重试解析',file.extraction||null,file.created_at]);
    }
    for(const link of data.attachmentLinks||[]) {
      if(missingAttachments.has(link.attachment_id))continue;
      const id=attachmentIds.get(link.attachment_id)||link.attachment_id,message=messageIds.get(link.message_id);
      if(!message||!queryOne('SELECT id FROM orbit_attachments WHERE user_id=? AND id=?',[userId,id]))throw new Error('附件消息备份引用不完整');
      run('INSERT OR IGNORE INTO orbit_message_attachments(user_id,message_id,attachment_id) VALUES (?,?,?)',[userId,message,id]);
    }
    // Imported reminders never replay pending jobs or implicitly enable autonomous AI calls.
    if(mode==='replace')run('UPDATE orbit_preferences SET proactive_enabled=0 WHERE user_id=?',[userId]);
    if(!foreign) {
      for(const r of data.reminderRules||[])if(getSchedule(r.schedule_id)?.user_id===userId && Number.isInteger(r.minutes)&&r.minutes>=0&&r.minutes<=10080)run('INSERT OR IGNORE INTO orbit_schedule_reminders (user_id,schedule_id,enabled,minutes,snoozed_until) VALUES (?,?,?,?,NULL)',[userId,r.schedule_id,r.enabled?1:0,r.minutes]);
      for(const e of data.knowledgeEvents||[])if(typeof e.id==='string'&&typeof e.entry_id==='string'&&['read','citation'].includes(e.kind)&&!Number.isNaN(Date.parse(e.created_at)))run('INSERT OR IGNORE INTO orbit_knowledge_events (id,user_id,entry_id,kind,created_at) VALUES (?,?,?,?,?)',[e.id,userId,e.entry_id,e.kind,e.created_at]);
      for(const e of data.proactiveEvents||[])if(getSchedule(e.schedule_id)?.user_id===userId)run('INSERT OR IGNORE INTO orbit_proactive_events (id,user_id,schedule_id,instance_id,expected_state,trigger_at,state,message_id,created_at,handled_action,handled_at,next_reminder_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',[e.id,userId,e.schedule_id,e.instance_id,e.expected_state,e.trigger_at,['sent','handled','discarded'].includes(e.state)?e.state:'discarded',e.message_id,e.created_at,e.handled_action||null,e.handled_at||null,e.next_reminder_at||null]);
    }
}
function restoredPlanSnapshot(value: string | null): string | null {
  if(!value)return null;
  const p=JSON.parse(value);
  if(!p.state || p.state==='pending' || p.state==='executing') {p.state='suspended';p.revision=(p.revision||1)+1;}
  return JSON.stringify(p);
}
export function recentObjectReferences(userId: string, id: string): Array<Array<{
    id: string;
    title: string;
}>> {
    conversation(userId, id);
    return queryAll<{
        schedule_items: string | null;
    }>('SELECT schedule_items FROM ai_schedule_messages WHERE user_id=? AND conversation_id=? AND role=? AND schedule_items IS NOT NULL ORDER BY created_at DESC,rowid DESC LIMIT 3', [userId, id, 'assistant']).map(row => {
        try {
            const items = JSON.parse(row.schedule_items || '[]');
            return Array.isArray(items) ? items.slice(0, 30).map(item => ({ id: String(item.id), title: String(item.title) })) : [];
        }
        catch {
            return [];
        }
    });
}
export function referencedIndex(text: string): number | null {
    const match = text.match(/第([一二三四五六七八九十]|\d+)[个项篇条]/);
    if (!match)
        return null;
    const value = /^\d+$/.test(match[1]) ? Number(match[1]) : '一二三四五六七八九十'.indexOf(match[1]) + 1;
    return value > 0 ? value - 1 : null;
}
export function previousKnowledgeIds(userId: string, id: string): string[] {
    conversation(userId, id);
    for (const row of queryAll<{
        knowledge_sources: string | null;
    }>('SELECT knowledge_sources FROM ai_schedule_messages WHERE user_id=? AND conversation_id=? AND role=? ORDER BY created_at DESC,rowid DESC LIMIT 20', [userId, id, 'assistant'])) {
        try {
            const sources = JSON.parse(row.knowledge_sources || '[]');
            if (Array.isArray(sources) && sources.length)
                return sources.slice(0, 10).map(source => String(source.id));
        }
        catch { }
    }
    return [];
}
import {messageAttachments} from './orbit-attachments.js';
