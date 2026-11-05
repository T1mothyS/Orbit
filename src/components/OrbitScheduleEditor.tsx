import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { CalendarDays, Check, MapPin, Pencil, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button, ConfirmDialog, Dialog, IconButton, Tooltip } from '../ui';
import { getScheduleCategory } from '../utils/scheduleCategories';
import { requestError } from '../utils/request-error';
import { formatTime } from './calendar/schedule-presentation';
import { ScheduleFormModal } from './calendar/ScheduleFormModal';
import type { Schedule } from './calendar/schedule-types';
import { OrbitReminderSettings } from './OrbitReminderSettings';
import { OrbitDialog } from './OrbitDialog';

export function OrbitScheduleEditor({ id, onClose, onSaved, returnFocus }: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const { authHeaders } = useAuth();
  const [schedule, setSchedule] = useState<Schedule>();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [date, setDate] = useState('');
  const dateInput = useRef<HTMLInputElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [expectedState, setExpectedState] = useState('');
  const initialDate = useRef('');
  const savingRef = useRef(false);
  const linked = id.startsWith('reminder-cycle:');
  const url = `/api/schedules/${encodeURIComponent(id)}`;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(url, { headers: authHeaders(), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '无法读取事项。');
        if (controller.signal.aborted) return;
        const planned = data.schedule.start_time.slice(0, 10);
        setSchedule(data.schedule);
        setDate(planned);
        initialDate.current = planned;
        setExpectedState(data.expectedState);
      }).catch(cause => { if (!controller.signal.aborted) setError(requestError(cause, '无法读取事项。', true)); });
    return () => controller.abort();
  }, [url, authHeaders]);

  async function mutate(method: string, body?: unknown, suffix = '') {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(url + suffix, {
        method, headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(30000), body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败');
      onSaved();
      onClose();
    } catch (cause) {
      if (editing) throw cause;
      setError(requestError(cause, '操作失败，请重试。', true));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (!schedule) return <Dialog open title="打开事项" onOpenChange={open => { if (!open) onClose(); }} returnFocus={returnFocus}>
    {error ? <p className="orbit-inline-error" role="alert">{error}</p> : <p role="status">正在加载…</p>}
  </Dialog>;

  if (linked) return <OrbitDialog label="本周期安排日期" busy={saving} error={error} onClose={onClose}
    discardMessage="放弃修改后，尚未保存的内容将丢失。是否继续？" canClose={() => date === initialDate.current}>
    {close => <section className="orbit-modal">
      <IconButton label="关闭" variant="quiet" className="orbit-modal-close" onClick={close} disabled={saving}><X size={19} aria-hidden="true" /></IconButton>
      <h3>{schedule.title}</h3>
      {error && <p className="orbit-inline-error" role="alert">{error}</p>}
      <p className="orbit-cycle-description">{schedule.description}</p>
      <fieldset className="orbit-form-fields" disabled={saving}>
        <label>本周期安排日期<input ref={dateInput} aria-label="本周期安排日期" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <p>只调整本周期的安排日期。</p>
        <Button variant="primary" disabled={!date} loading={saving} onClick={() => void mutate('PATCH', { date: dateInput.current?.value || date, expectedState }, '/planned-date')}>保存安排日期</Button>
        <Button onClick={() => void mutate('PATCH', { date: null, expectedState }, '/planned-date')}>恢复按到期日安排</Button>
        <OrbitReminderSettings id={id} />
      </fieldset>
      <Link to="/reminders">编辑周期规则或登记完成</Link>
    </section>}
  </OrbitDialog>;

  if (editing) return <ScheduleFormModal defaultDate={new Date(schedule.start_time)}
    editingSchedule={schedule} onClose={onClose} onSave={fields => mutate('PATCH', { ...fields, expectedState })} />;

  const category = getScheduleCategory(schedule.category);
  const completionAction = schedule.is_completed ? '恢复待办' : '标记完成';
  const start = formatTime(schedule.start_time);
  const end = schedule.end_time ? formatTime(schedule.end_time) : '';
  const when = schedule.is_unscheduled ? '无固定日期' :
    `${new Date(schedule.start_time).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })} · ${schedule.all_day ? '全天' : start + (end && end !== start ? '–' + end : '')}`;

  return <Dialog open title={schedule.title} busy={saving} returnFocus={returnFocus} onOpenChange={open => { if (!open) onClose(); }}
    headerActions={<div className="orbit-chat-detail-actions" role="group" aria-label="日程操作">
      <Tooltip content="删除"><IconButton ref={deleteButton} label="删除" variant="quiet" disabled={saving} onClick={() => { setError(''); setDeleting(true); }}>
        <Trash2 className="orbit-chat-detail-delete" size={19} aria-hidden="true" />
      </IconButton></Tooltip>
      <Tooltip content={completionAction}><IconButton label={completionAction} variant="quiet" disabled={saving} onClick={() => void mutate('POST', {}, '/toggle')}>
        <span className="orbit-chat-detail-check"><Check size={21} strokeWidth={2.4} aria-hidden="true" /></span>
      </IconButton></Tooltip>
      <Tooltip content="编辑"><IconButton label="编辑" variant="quiet" disabled={saving} onClick={() => setEditing(true)}><Pencil size={19} aria-hidden="true" /></IconButton></Tooltip>
    </div>}>
    <div className="orbit-chat-detail">
      <div className="orbit-chat-detail-meta">
        <span><CalendarDays size={17} aria-hidden="true" />{when}</span>
        <span className="orbit-chat-detail-category" style={{ '--schedule-category': category.color } as CSSProperties}>{category.name}</span>
        {schedule.is_completed && <span className="orbit-chat-detail-done"><Check size={15} aria-hidden="true" />已完成</span>}
      </div>
      {schedule.location && <p className="orbit-chat-detail-place"><MapPin size={17} aria-hidden="true" />{schedule.location}</p>}
      {schedule.notes && <p className="orbit-chat-detail-note">{schedule.notes}</p>}
      {schedule.description && <p className="orbit-chat-detail-note">{schedule.description}</p>}
      <OrbitReminderSettings id={id} />
      {error && !deleting && <p className="orbit-inline-error" role="alert">{error}</p>}
    </div>
    <ConfirmDialog open={deleting} onOpenChange={setDeleting} title="删除这条日程？"
      description={`「${schedule.title}」删除后无法撤销。`} confirmLabel="删除日程"
      busy={saving} returnFocus={deleteButton} onConfirm={() => void mutate('DELETE')}>
      {error && deleting && <p className="orbit-inline-error" role="alert">{error}</p>}
    </ConfirmDialog>
  </Dialog>;
}
