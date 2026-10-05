import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
export interface OrbitConversation {
    id: string;
    title: string;
    is_main?: number;
    scope_schedule_id?: string | null;
    unread?: number;
}
export interface OrbitRequest {
    id: string;
    text: string;
    state: string;
    error?: string;
    createdAt?:string;
    steps?:Array<{id:string;label:string;state:string;query?:string;at:string}>;
}
export function useOrbitChat(authHeaders: () => Record<string, string>, authenticated: boolean) {
    const [params, setParams] = useSearchParams();
    const [conversations, setConversations] = useState<OrbitConversation[]>([]);
    const [requests, setRequests] = useState<OrbitRequest[]>([]);
    const [history, setHistory] = useState<any[]>([]);
    const [error, setError] = useState('');
    const [refreshError, setRefreshError] = useState('');
    const [autoKnowledge, setAutoKnowledge] = useState(false);
    const [proactiveEnabled,setProactiveEnabled]=useState(false),[runnerEnabled,setRunnerEnabled]=useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [creating, setCreating] = useState(false);
    const creatingRef = useRef(false);
    const [mutating, setMutating] = useState(false);
    const mutatingRef = useRef(false);
    const submittingRef = useRef(false);
    const pendingSubmission = useRef<{
        signature:string;
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
        current.current = id;
        setParams(previous => { const next = new URLSearchParams(previous); next.set('conversation', id); return next; });
    }, [setParams]);
    const refresh = useCallback(async () => {
        if (!cid || mutatingRef.current)
            return;
        const revision = ++refreshRevision.current;
        const [messages, jobs, list] = await Promise.all([api(`/api/ai-schedule/history?conversationId=${encodeURIComponent(cid)}`), api(`/api/orbit/requests?conversationId=${encodeURIComponent(cid)}`),api('/api/orbit/conversations')]);
        if (current.current !== cid || refreshRevision.current !== revision)
            return;
        setRefreshError('');
        setHistory(previous => JSON.stringify(previous) === JSON.stringify(messages.messages) ? previous : messages.messages);
        setRequests(previous => JSON.stringify(previous) === JSON.stringify(jobs.requests) ? previous : jobs.requests);
        setConversations(previous=>JSON.stringify(previous)===JSON.stringify(list.conversations)?previous:list.conversations);
        if(document.visibilityState==='visible' && list.conversations.some((c:OrbitConversation)=>c.id===cid && c.unread)) await api(`/api/orbit/conversations/${encodeURIComponent(cid)}/read`,'POST',{observedAt:messages.messages.at(-1)?.timestamp});
    }, [api, cid]);
    const refreshConversations = useCallback(async () => {
        const data = await api('/api/orbit/conversations');
        setConversations(data.conversations);
        return data.conversations as OrbitConversation[];
    }, [api]);
    const streamId=requests.find(r=>r.state==='running')?.id||requests.find(r=>r.state==='queued')?.id;
    useEffect(()=>{
        if(!authenticated||!cid||!streamId)return;
        const controller=new AbortController();
        void (async()=>{try{const res=await fetch(`/api/orbit/requests/${encodeURIComponent(streamId)}/events`,{headers:authHeaders(),signal:controller.signal});if(!res.ok||!res.body)return;const reader=res.body.getReader(),decoder=new TextDecoder();let pending='';try{for(;;){const {done,value}=await reader.read();if(done)break;pending=(pending+decoder.decode(value,{stream:true})).replace(/\r\n/g,'\n');let i;while((i=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,i);pending=pending.slice(i+2);const line=frame.split('\n').find(l=>l.startsWith('data: '));if(line&&current.current===cid){const row=JSON.parse(line.slice(6));setRequests(old=>old.map(r=>r.id===row.id?row:r));}}}}finally{await reader.cancel();}if(!controller.signal.aborted)await refresh();}catch{/* Existing authenticated polling recovers dropped streams. */}})();
        return()=>controller.abort();
    },[authenticated,cid,streamId,authHeaders,refresh]);
    useEffect(() => {
        if (!authenticated)
            return;
        let alive = true;
        void refreshConversations().then(items => { if (alive && !current.current && items[0])
            select(items[0].id); }).catch(e => setError(e.message));
        void api('/api/orbit/preferences').then(data => { if (alive)
            {setAutoKnowledge(data.autoKnowledge);setProactiveEnabled(data.proactiveEnabled);setRunnerEnabled(data.runnerEnabled);} }).catch(e => setError(e.message));
        return () => { alive = false; };
    }, [authenticated, api, refreshConversations, select]);
    useEffect(() => {
        if (!authenticated || !cid)
            return;
        setHistory([]);
        setRequests([]);
        setError(''); setRefreshError('');
        let stopped = false;
        let timer: ReturnType<typeof setTimeout>;
        const tick = async () => {
            try {
                await refresh();
            }
            catch (e) {
                if (!stopped)
                    setRefreshError(e instanceof Error && e.name === 'TimeoutError' ? '状态刷新超时，正在重新连接…' : '状态暂时无法刷新，正在重新连接…');
            }
            if (!stopped)
                timer = setTimeout(tick, 2000);
        };
        void tick();
        return () => { stopped = true; clearTimeout(timer); };
    }, [authenticated, cid, refresh]);
    const create = useCallback(async (scopeScheduleId?: string, title?: string) => {
        if (creatingRef.current || mutatingRef.current) return;
        creatingRef.current = true;
        setCreating(true);
        try {
            const data = await api('/api/orbit/conversations', 'POST', {scopeScheduleId,title});
            await refreshConversations();
            select(data.conversation.id);
        } finally {
            creatingRef.current = false;
            setCreating(false);
        }
    }, [api, refreshConversations, select]);
    const send = useCallback(async (text: string, body: Record<string, unknown>) => {
        if (creatingRef.current || mutatingRef.current || current.current !== cid) return false;
        if (!cid)
            throw new Error('请先选择一个对话');
        if (submittingRef.current)
            return false;
        submittingRef.current = true;
        setSubmitting(true);
        try {
            const old = pendingSubmission.current;
            const signature=JSON.stringify(body);
            const id = old?.text === text && old.cid === cid && old.signature===signature ? old.id : crypto.randomUUID();
            pendingSubmission.current = { text, cid, id,signature };
            setError('');
            try { await api('/api/orbit/requests', 'POST', { ...body, text, requestId: id, conversationId: cid }); }
            catch (cause) { throw cause instanceof Error && cause.name === 'TimeoutError' ? new Error('发送结果暂未确认，输入已保留；重试相同内容会核对同一条请求。') : cause; }
            pendingSubmission.current = null;
            // An accepted request stays accepted even if the subsequent status read fails.
            try { await refresh(); } catch { setRefreshError('消息已加入队列，状态暂时无法刷新；正在重新连接…'); }
            return true;
        }
        finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    }, [api, cid, refresh]);
    const action = useCallback(async (id: string, verb: 'cancel' | 'retry') => { await api(`/api/orbit/requests/${encodeURIComponent(id)}/${verb}`, 'POST', {}); await refresh(); }, [api, refresh]);
    const rename = useCallback(async (title: string, id=cid) => { await api(`/api/orbit/conversations/${encodeURIComponent(id)}`, 'PATCH', { title }); await refreshConversations(); }, [api, cid, refreshConversations]);
    const remove = useCallback(async (id=cid) => {
        if (mutatingRef.current || creatingRef.current || submittingRef.current) throw new Error('请等待当前操作结束');
        mutatingRef.current = true; setMutating(true); ++refreshRevision.current;
        try {
            const result = await api(`/api/orbit/conversations/${encodeURIComponent(id)}`, 'DELETE');
            if (result.attachmentCleanupPending) setError('对话已删除，部分附件文件清理失败，请联系管理员检查存储权限。');
            const remaining = conversations.filter(c => c.id !== id);
            setConversations(remaining);
            if (current.current === id && remaining[0]) select(remaining[0].id);
            try { await refreshConversations(); } catch { setRefreshError('对话已删除，列表暂时无法刷新；正在重新连接…'); }
        } finally { mutatingRef.current = false; setMutating(false); }
    }, [api, cid, conversations, refreshConversations, select]);
    const clear = useCallback(async (id=cid) => {
        if (!id || mutatingRef.current || creatingRef.current || submittingRef.current) throw new Error('请等待当前操作结束');
        mutatingRef.current = true; setMutating(true); ++refreshRevision.current;
        try {
            const result = await api(`/api/ai-schedule/history?conversationId=${encodeURIComponent(id)}`, 'DELETE');
            if (result.attachmentCleanupPending) setError('历史已清空，部分附件文件清理失败，请联系管理员检查存储权限。');
            if (current.current === id) { pendingSubmission.current = null; setHistory([]); setRequests([]); }
        } finally { mutatingRef.current = false; setMutating(false); }
        try { await refresh(); } catch { setRefreshError('历史已清空，状态暂时无法刷新；正在重新连接…'); }
    }, [api, cid, refresh]);
    const preference = useCallback(async (value: boolean) => { await api('/api/orbit/preferences', 'PATCH', { autoKnowledge: value }); setAutoKnowledge(value); }, [api]);
    const proactivePreference=useCallback(async(value:boolean)=>{await api('/api/orbit/preferences','PATCH',{proactiveEnabled:value});setProactiveEnabled(value);},[api]);
    const reminderAction=useCallback(async(id:string,action:string)=>{await api(`/api/orbit/reminders/${encodeURIComponent(id)}/${action}`,'POST',{});await refresh();},[api,refresh]);
    return { cid, conversations, requests, history, error, refreshError, setError, autoKnowledge,proactiveEnabled,runnerEnabled, submitting, creating, mutating, select, create, send, action, rename, remove, clear, preference,proactivePreference,reminderAction, refresh };
}
