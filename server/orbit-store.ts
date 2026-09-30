import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { queryAll, queryOne, run } from './database/connection.js';
import { withPersistenceTransaction } from './persistence.js';
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
export function createConversation(userId: string, title = '新对话'): Conversation {
    const now = new Date().toISOString();
    const id = randomUUID();
    run('INSERT INTO orbit_conversations VALUES (?,?,?,?,?)', [id, userId, title.trim().slice(0, 100) || '新对话', now, now]);
    return conversation(userId, id);
}
export function ensureDefaultConversation(userId: string): string {
    return withPersistenceTransaction(() => {
        let item = queryOne<Conversation>('SELECT * FROM orbit_conversations WHERE user_id=? ORDER BY created_at,id LIMIT 1', [userId]);
        if (!item)
            item = createConversation(userId, '已有对话');
        run('UPDATE ai_schedule_messages SET conversation_id=? WHERE user_id=? AND conversation_id IS NULL', [item.id, userId]);
        return item.id;
    });
}
export function listConversations(userId: string): Conversation[] {
    ensureDefaultConversation(userId);
    return queryAll<Conversation>('SELECT * FROM orbit_conversations WHERE user_id=? ORDER BY updated_at DESC,id', [userId]);
}
export function renameConversation(userId: string, id: string, title: string) {
    conversation(userId, id);
    if (!title.trim() || title.length > 100)
        throw new Error('会话名称应为 1–100 字');
    run('UPDATE orbit_conversations SET title=?,updated_at=? WHERE id=? AND user_id=?', [title.trim(), new Date().toISOString(), id, userId]);
}
export function deleteConversation(userId: string, id: string) {
    conversation(userId, id);
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
        role: string;
        content: string;
        schedule_items: string | null;
        knowledge_sources: string | null;
        plan: string | null;
    }>('SELECT role,content,schedule_items,knowledge_sources,plan FROM ai_schedule_messages WHERE user_id=? AND conversation_id=? ORDER BY created_at DESC,rowid DESC LIMIT 20', [userId, id]);
    let remaining = 12000;
    const selected: string[] = [];
    for (const row of rows) {
        const part = `${row.role}: ${row.content}\n对象引用：${row.schedule_items || ''}\n知识引用：${row.knowledge_sources || ''}\n待确认计划：${row.plan || ''}`;
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
export function setAiPreference(userId: string, value: boolean) { run('INSERT OR REPLACE INTO orbit_preferences VALUES (?,?)', [userId, value ? 1 : 0]); }
export function getRequest(userId: string, id: string): ChatRequest | undefined { return queryOne<ChatRequest>('SELECT * FROM orbit_requests WHERE user_id=? AND id=?', [userId, id]); }
export function exportOrbit(userId: string) {
    return { conversations: queryAll<Conversation>('SELECT * FROM orbit_conversations WHERE user_id=?', [userId]), messages: queryAll<any>('SELECT * FROM ai_schedule_messages WHERE user_id=?', [userId]), autoKnowledge: getAiPreference(userId) };
}
export function restoreOrbit(userId: string, data: ReturnType<typeof exportOrbit>, mode: 'merge' | 'replace', foreign = false) {
    if (!data || !Array.isArray(data.conversations) || !Array.isArray(data.messages))
        throw new Error('会话备份格式不正确');
    const ids = new Map<string, string>();
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
            run('INSERT INTO orbit_conversations VALUES (?,?,?,?,?)', [id, userId, c.title, c.created_at, c.updated_at]);
    }
    const fallback = ensureDefaultConversation(userId);
    for (const m of data.messages) {
        const id = foreign ? randomUUID() : m.id;
        const existing = queryOne<{
            user_id: string;
        }>('SELECT user_id FROM ai_schedule_messages WHERE id=?', [id]);
        if (existing && existing.user_id !== userId)
            throw new Error('消息编号属于其他账号');
        if (!existing)
            run('INSERT INTO ai_schedule_messages (id,user_id,role,type,content,intent,schedule_items,plan,knowledge_sources,created_at,conversation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, userId, m.role, m.type, m.content, m.intent, foreign ? null : m.schedule_items, foreign ? null : m.plan, foreign ? null : m.knowledge_sources, m.created_at, ids.get(m.conversation_id) || fallback]);
    }
    setAiPreference(userId, data.autoKnowledge === true);
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
