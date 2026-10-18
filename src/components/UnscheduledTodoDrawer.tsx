import { useCallback, useEffect, useId, useState } from 'react';
import { CheckCircle2, Circle, Edit3, MoreHorizontal, Trash2 } from 'lucide-react';
import { ActionRow, Button, Dialog, IconButton, Input, Menu, Select } from '../ui';
import { useAuth } from '../hooks/useAuth';
import { ScheduleFormModal } from './calendar/ScheduleFormModal';
import type { Schedule } from './calendar/schedule-types';
import '../styles/unscheduled.css';

interface Completion { id: string; completedAt: string; reopenedAt: string | null; note: string | null }

export function UnscheduledTodoDrawer({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { authHeaders } = useAuth();
  const searchId = useId();
  const [rows, setRows] = useState<Schedule[]>([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<Completion[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const dismissEditor = () => {
    if (busy) return;
    if (window.confirm('放弃本次未保存的编辑？')) setEditing(null);
  };
  const dismiss = () => {
    if (busy) return;
    if (editing) { dismissEditor(); return; }
    onClose();
  };
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/schedules/unscheduled', { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '加载待办失败');
      setRows(data.schedules);
    } catch (e) { setError(e instanceof Error ? e.message : '加载待办失败'); }
    finally { setLoading(false); }
  }, [authHeaders]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController();
    setHistory([]); setHistoryError(''); setHistoryLoading(true);
    fetch('/api/history?sourceType=schedule&sourceId=' + encodeURIComponent(selected), { headers: authHeaders(), signal: abort.signal })
      .then(async response => { if (!response.ok) throw new Error('完成记录读取失败'); return response.json(); })
      .then(data => { if (!abort.signal.aborted) setHistory(data.completions); })
      .catch(e => { if (!abort.signal.aborted) setHistoryError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setHistoryLoading(false); });
    return () => abort.abort();
  }, [selected, authHeaders]);
  const mutate = async (id: string, method: string, body?: Partial<Schedule>, toggle = false) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/schedules/' + encodeURIComponent(id) + (toggle ? '/toggle' : ''), {
        method, headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '操作失败');
      setEditing(null); setSelected(null); await load(); onChanged();
    } catch (e) { if (editing) throw e; setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  };
  const completed = rows.filter(row => row.is_completed).length;
  const visible = rows.filter(row => (filter === 'all' || row.is_completed === (filter === 'completed'))
    && [row.title, row.description, row.notes].some(text => (text || '').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
  return <Dialog open onOpenChange={open => { if (!open) dismiss(); }} title="无固定期限待办" description="没有执行期限；完成后仍可在这里查看和管理。" size="wide" busy={busy} footer={<><span className="oui-help">未完成 {rows.length - completed} 项 · 共 {rows.length} 项</span><Button disabled={busy} onClick={dismiss}>关闭</Button></>}>
    <div className="unscheduled-workspace">
    <div className="unscheduled-filters">
      <label>状态<Select label="状态" value={filter} onValueChange={value => setFilter(value || 'all')} options={[{value:'all',label:`全部（${rows.length}）`},{value:'pending',label:`未完成（${rows.length - completed}）`},{value:'completed',label:`已完成（${completed}）`}]} /></label>
      <label htmlFor={searchId}>搜索<Input id={searchId} value={query} onChange={e => setQuery(e.target.value)} placeholder="标题、描述或备注" /></label>
    </div>
    {error && <div role="alert">{error}<Button disabled={busy || loading} onClick={() => void load()}>重新加载</Button></div>}
    <div className="unscheduled-list" aria-busy={loading || busy}>
      {loading && !rows.length ? <p role="status">正在加载待办…</p> : visible.length === 0 ? <p>没有符合条件的待办</p> : visible.map(row => <article key={row.id}>
        <div className="unscheduled-task-row"><IconButton label={`${row.is_completed ? '设为未完成' : '标记完成'}：${row.title}`} variant="quiet" aria-pressed={row.is_completed} disabled={busy} onClick={() => void mutate(row.id, 'POST', undefined, true)}>{row.is_completed ? <CheckCircle2 size={20} /> : <Circle size={20} />}</IconButton>
        <ActionRow compact title={row.title} aria-label={`详情：${row.title}`} aria-expanded={selected === row.id} aria-controls={'todo-detail-' + row.id} onClick={() => setSelected(selected === row.id ? null : row.id)} description={`${row.is_completed ? '已完成' : '未完成'} · ${{ high: '高', medium: '中', low: '低' }[row.priority]}优先级`} />
        <Menu label={`${row.title} 的更多操作`} trigger={<IconButton label={`更多操作：${row.title}`} variant="quiet" disabled={busy}><MoreHorizontal size={20}/></IconButton>} items={[
          {id:'edit',label:'编辑',icon:<Edit3 size={16}/>,disabled:busy,onSelect:()=>setEditing(row)},
          {id:'delete',label:'删除',icon:<Trash2 size={16}/>,danger:true,separatorBefore:true,disabled:busy,onSelect:()=>{if(window.confirm(`确定删除“${row.title}”吗？`))void mutate(row.id,'DELETE');}},
        ]} /></div>
        {selected === row.id && <div className="unscheduled-details" id={'todo-detail-' + row.id}>
          <p>历史保存时间（不是执行期限）：{row.start_time}</p>
          {row.description && <p>描述：{row.description}</p>}{row.notes && <p>备注：{row.notes}</p>}
          <h4>完成记录</h4>{historyLoading ? <p>读取中…</p> : historyError ? <p role="alert">{historyError}</p> : history.length === 0 ? <p>无完成记录；当前状态以待办为准。</p> : history.map(item => <p key={item.id}>{item.completedAt}{item.reopenedAt ? '（已重新打开）' : ''}{item.note ? '：' + item.note : ''}</p>)}
        </div>}
      </article>)}
    </div>
    </div>
    {editing && <div className="unscheduled-editor" aria-busy={busy}>
      {error && <p className="unscheduled-edit-error" role="alert">{error}</p>}
      <ScheduleFormModal editingSchedule={editing} defaultDate={new Date()} onClose={dismissEditor} confirmDiscard={false} onSave={body => mutate(editing.id, 'PUT', body)} />
    </div>}
  </Dialog>;
}
