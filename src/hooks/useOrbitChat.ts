import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
export interface OrbitConversation {
    id: string;
    title: string;
}
export interface OrbitRequest {
    id: string;
    text: string;
    state: string;
    error?: string;
}
export function useOrbitChat(authHeaders: () => Record<string, string>, authenticated: boolean) {
    const [params, setParams] = useSearchParams();
    const [conversations, setConversations] = useState<OrbitConversation[]>([]);
    const [requests, setRequests] = useState<OrbitRequest[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [error, setError] = useState('');
    const [autoKnowledge, setAutoKnowledge] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const pendingSubmission = useRef<{
        text: string;
        cid: string;
        id: string;
    } | null>(null);
    const cid = params.get('conversation') || '';
    const refreshRevision = useRef(0);
    const current = useRef(cid);
    current.current = cid;
    const api = useCallback(async (path: string, method = 'GET', body?: unknown) => {
        const res = await fetch(path, { method, headers: { ...authHeaders(), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) });
        const data = await res.json();
        if (!res.ok)
            throw new Error(data.error || '操作失败');
        return data;
    }, [authHeaders]);
    const select = useCallback((id: string) => {
        setParams(previous => { const next = new URLSearchParams(previous); next.set('conversation', id); return next; });
    }, [setParams]);
    const refresh = useCallback(async () => {
        if (!cid)
            return;
        const revision = ++refreshRevision.current;
        const [messages, jobs] = await Promise.all([api(`/api/ai-schedule/history?conversationId=${encodeURIComponent(cid)}`), api(`/api/orbit/requests?conversationId=${encodeURIComponent(cid)}`)]);
        if (current.current !== cid || refreshRevision.current !== revision)
            return;
        setHistory(previous => JSON.stringify(previous) === JSON.stringify(messages.messages) ? previous : messages.messages);
        setRequests(previous => JSON.stringify(previous) === JSON.stringify(jobs.requests) ? previous : jobs.requests);
    }, [api, cid]);
    const refreshConversations = useCallback(async () => {
        const data = await api('/api/orbit/conversations');
        setConversations(data.conversations);
        return data.conversations as OrbitConversation[];
    }, [api]);
    useEffect(() => {
        if (!authenticated)
            return;
        let alive = true;
        void refreshConversations().then(items => { if (alive && !current.current && items[0])
            select(items[0].id); }).catch(e => setError(e.message));
        void api('/api/orbit/preferences').then(data => { if (alive)
            setAutoKnowledge(data.autoKnowledge); }).catch(e => setError(e.message));
        return () => { alive = false; };
    }, [authenticated, api, refreshConversations, select]);
    useEffect(() => {
        if (!authenticated || !cid)
            return;
        setHistory([]);
        setRequests([]);
        setError('');
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const tick = async () => {
            try {
                await refresh();
            }
            catch (e) {
                if (!stopped)
                    setError(e instanceof Error ? e.message : '加载失败');
            }
            if (!stopped)
                timer = setTimeout(tick, 2000);
        };
        void tick();
        return () => { stopped = true; clearTimeout(timer); };
    }, [authenticated, cid, refresh]);
    const create = useCallback(async () => {
        const data = await api('/api/orbit/conversations', 'POST', {});
        await refreshConversations();
        select(data.conversation.id);
    }, [api, refreshConversations, select]);
    const send = useCallback(async (text: string, body: Record<string, unknown>) => {
        if (!cid)
            throw new Error('请先选择一个对话');
        if (submittingRef.current)
            return false;
        submittingRef.current = true;
        setSubmitting(true);
        try {
            const old = pendingSubmission.current;
            const id = old?.text === text && old.cid === cid ? old.id : crypto.randomUUID();
            pendingSubmission.current = { text, cid, id };
            await api('/api/orbit/requests', 'POST', { ...body, text, requestId: id, conversationId: cid });
            pendingSubmission.current = null;
            // An accepted request stays accepted even if the subsequent status read fails.
            try { await refresh(); } catch { setError('消息已加入队列，状态暂时无法刷新；请稍后查看，避免重复发送。'); }
            return true;
        }
        finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    }, [api, cid, refresh]);
    const action = useCallback(async (id: string, verb: 'cancel' | 'retry') => { await api(`/api/orbit/requests/${encodeURIComponent(id)}/${verb}`, 'POST', {}); await refresh(); }, [api, refresh]);
    const rename = useCallback(async (title: string) => { await api(`/api/orbit/conversations/${encodeURIComponent(cid)}`, 'PATCH', { title }); await refreshConversations(); }, [api, cid, refreshConversations]);
    const remove = useCallback(async () => { await api(`/api/orbit/conversations/${encodeURIComponent(cid)}`, 'DELETE'); const items = await refreshConversations(); if (items[0])
        select(items[0].id); }, [api, cid, refreshConversations, select]);
    const preference = useCallback(async (value: boolean) => { await api('/api/orbit/preferences', 'PATCH', { autoKnowledge: value }); setAutoKnowledge(value); }, [api]);
    return { cid, conversations, requests, history, error, setError, autoKnowledge, submitting, select, create, send, action, rename, remove, preference, refresh };
}
