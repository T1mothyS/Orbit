import { Calendar, CheckCircle2, Ellipsis, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { SCHEDULE_CATEGORIES } from '../../utils/scheduleCategories';
import { formatTime, toDateKey, shiftDateKey, linkedEndTime } from './schedule-presentation';
import type { Schedule } from './schedule-types';
import { Button, IconButton, Input, Textarea, TimePicker, isClockTime, useActionConfirmation } from '../../ui';
import { useDialogLifecycle } from '../../hooks/useDialogLifecycle';
import { ScheduleStepSlider, ScheduleTimeModeSwitch, type ScheduleTimeMode } from './ScheduleChoices';

const categories = SCHEDULE_CATEGORIES.map(category => ({ value: category.id, label: category.name, tone: category.id }));
const priorities = [
  { value: 'low', label: '低', tone: 'life' },
  { value: 'medium', label: '中', tone: 'travel' },
  { value: 'high', label: '高', tone: 'health' },
];
const reminders = [
  { value: '', label: '不提醒', tone: 'other' },
  { value: '5', label: '5 分钟', tone: 'life' },
  { value: '15', label: '15 分钟', tone: 'work' },
  { value: '30', label: '30 分钟', tone: 'violet' },
  { value: '60', label: '1 小时', tone: 'social' },
];

export function ScheduleFormModal({
  defaultDate,
  editingSchedule,
  defaultCategory,
  onSave,
  onClose,
  confirmDiscard = true,
}: {
  defaultDate: Date;
  editingSchedule?: Schedule | null;
  defaultCategory?: string;
  onSave: (s: Partial<Schedule>) => void | Promise<void>;
  onClose: () => void;
  confirmDiscard?: boolean;
}) {
  const isEditing = !!editingSchedule;
  const dialogRef = useRef<HTMLDialogElement>(null);
  useDialogLifecycle(dialogRef, true, '[aria-label="日程标题"]');
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    type: (editingSchedule?.type || 'event') as 'event' | 'todo',
    title: editingSchedule?.title || '',
    date: editingSchedule?.is_unscheduled ? '' : editingSchedule
      ? editingSchedule.start_time.split('T')[0]
      : toDateKey(defaultDate),
    isUnscheduled: editingSchedule?.is_unscheduled === true,
    startTime: editingSchedule && !editingSchedule.all_day
      ? formatTime(editingSchedule.start_time)
      : '09:00',
    endTime: editingSchedule?.type === 'event' && !editingSchedule.all_day
      ? editingSchedule.end_time ? formatTime(editingSchedule.end_time) : ''
      : '10:00',
    endDate: editingSchedule?.end_time
      ? editingSchedule.end_time.slice(0, 10)
      : editingSchedule ? editingSchedule.start_time.split('T')[0] : toDateKey(defaultDate),
    all_day: editingSchedule?.all_day || false,
    location: editingSchedule?.location || '',
    category: editingSchedule?.category || (SCHEDULE_CATEGORIES.some(category => category.id === defaultCategory) ? defaultCategory! : 'other'),
    priority: (editingSchedule?.priority || 'medium') as 'high' | 'medium' | 'low',
    notes: editingSchedule?.notes || '',
    reminder: (editingSchedule?.reminders?.[0] || '') as string,
    calendarId: editingSchedule?.calendar_id || 'personal',
  });

  const confirmation = useActionConfirmation();
  const initialForm = useRef(JSON.stringify(form));
  const saveFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { if (!saving && saveFocus.current?.isConnected) { saveFocus.current.focus({preventScroll:true}); saveFocus.current = null; } }, [saving]);
  const dismiss = () => {
    if (savingRef.current) return;
    if (!confirmation.discard(confirmDiscard && initialForm.current !== JSON.stringify(form), onClose)) return;
    onClose();
  };
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setError('');
    setForm(prev => ({ ...prev, [k]: v, ...(k === 'date' ? {
      endDate: shiftDateKey(String(v), Math.max(0, Math.round((Date.parse(`${prev.endDate}T12:00Z`) - Date.parse(`${prev.date}T12:00Z`)) / 86400000) || 0)),
    } : {}) }));
  };
  const isUnscheduled = form.type === 'todo' && form.isUnscheduled;
  const timed = !isUnscheduled && !form.all_day;
  const mode = isUnscheduled ? 'unscheduled' : form.all_day ? 'allDay' : 'timed';
  const legacyReminder = !reminders.some(option => option.value === form.reminder);
  const title = (isEditing ? '编辑' : '新增') + (form.type === 'todo' ? '待办' : '日程');

  function changeMode(value: ScheduleTimeMode) {
    setError('');
    setForm(prev => ({ ...prev, isUnscheduled: value === 'unscheduled', all_day: value === 'allDay' }));
  }

  const handleSave = async () => {
    if (savingRef.current || !form.title.trim()) return;
    if (!isUnscheduled && !form.all_day && (!isClockTime(form.startTime) || (form.type === 'event' && form.endTime && !isClockTime(form.endTime)))) { setError('请输入有效的时间（00:00–23:59）'); return; }
    if (!isUnscheduled && (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || Number.isNaN(Date.parse(form.date)))) {
      setError('请选择执行日期'); return;
    }
    const startTime = isUnscheduled
      ? editingSchedule?.start_time || new Date().toISOString()
      : form.all_day
      ? `${form.date}T00:00:00`
      : `${form.date}T${form.startTime}:00`;
    // 待办是时间点；结束时间只属于有持续时长的事件。
    const endDate = form.endDate || form.date;
    const endTime = form.type !== 'event' ? ''
      : form.all_day ? (editingSchedule?.all_day && editingSchedule.end_time ? `${endDate}T00:00:00` : '')
      : form.endTime ? `${endDate}T${form.endTime}:00` : '';
    if (endTime && endTime < startTime) { setError('结束时间不能早于开始时间'); return; }

    savingRef.current = true;
    saveFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSaving(true);
    setError('');
    try { await onSave({
      type: form.type,
      title: form.title.trim(),
      calendar_id: form.calendarId,
      start_time: startTime,
      end_time: endTime,
      all_day: isUnscheduled ? false : form.all_day,
      is_unscheduled: isUnscheduled,
      location: form.location,
      notes: form.notes,
      category: form.category,
      priority: form.priority,
      reminders: isUnscheduled ? [] : form.reminder === (editingSchedule?.reminders?.[0] || '')
        ? editingSchedule?.reminders || [] : form.reminder ? [form.reminder] : [],
      ...(isUnscheduled ? { is_repeated: false, repeat_rule: '' } : {}),
    }); } catch (cause) {
      setError(cause instanceof Error && cause.name === 'TimeoutError'
        ? '保存结果暂未确认，输入已保留。请先重新加载核对，避免重复创建。'
        : cause instanceof TypeError ? '网络连接失败，输入已保留。请先核对日程，再重试保存。'
        : cause instanceof Error ? cause.message : '保存失败，输入已保留，请重试。');
    } finally { savingRef.current = false; setSaving(false); }
  };

  return (
    <dialog ref={dialogRef} aria-label={title}
      className="orbit-dialog-viewport fixed inset-0 z-50 flex items-center justify-center schedule-editor-dialog"
      onCancel={event => { event.preventDefault(); event.stopPropagation(); dismiss(); }}
      onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
      {confirmation.dialog}
      <div className="schedule-form-modal" data-schedule-kind={form.type}>
        <header className="schedule-editor-header">
          <h3 className="schedule-form-heading">{title}</h3>
          <IconButton variant="quiet" onClick={dismiss} disabled={saving} label="关闭日程编辑" className="schedule-editor-close">
            <X size={20} aria-hidden="true" />
          </IconButton>
        </header>
        <div className="schedule-form-scroll">
          <fieldset disabled={saving} className="schedule-form-fields">
            <div className="schedule-editor-kind" role="group" aria-label="事项类型">
              {(['event', 'todo'] as const).map(type => <Button key={type} variant="quiet" aria-pressed={form.type === type}
                leadingIcon={type === 'event' ? <Calendar size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                onClick={() => {
                  setError('');
                  setForm(prev => ({ ...prev, type, isUnscheduled: type === 'todo' && prev.isUnscheduled }));
                }}>
                {type === 'event' ? '日程' : '待办'}
              </Button>)}
            </div>
            <label className="schedule-editor-field">标题
              <Input type="text" placeholder="输入日程标题..." aria-label="日程标题" value={form.title} maxLength={200} onChange={event => set('title', event.target.value)} />
            </label>
            <section className="schedule-editor-section" aria-label="时间安排">
              <h4><Calendar size={16} aria-hidden="true" />时间安排</h4>
              <ScheduleTimeModeSwitch value={mode} canBeUnscheduled={form.type === 'todo'} onChange={changeMode} />
              {isUnscheduled ? <p className="schedule-editor-help">完成前持续保留，可随时再安排日期。</p> : <>
                <div className={'schedule-editor-grid' + (timed ? ' is-pair' : '')}>
                  <label className="schedule-editor-field">日期
                    <Input id="schedule-date-input" type="date" value={form.date} onChange={event => set('date', event.target.value)} />
                  </label>
                  {timed && <div className="schedule-editor-field">
                    <span>{form.type === 'event' ? '开始时间' : '待办时间点'}</span>
                    <TimePicker value={form.startTime} label={form.type === 'event' ? '开始' : '时间点'} onChange={value => {
                      setError('');
                      setForm(prev => ({ ...prev, startTime: value, ...(prev.type === 'event' && prev.endTime && isClockTime(value) ? linkedEndTime(prev.date, value, prev.endDate, prev.endTime) : {}) }));
                    }} />
                  </div>}
                </div>
                {timed && form.type === 'event' && <div className="schedule-editor-grid is-pair">
                  <label className="schedule-editor-field">结束日期 <small>选填</small>
                    <Input type="date" value={form.endDate} min={form.date} onChange={event => set('endDate', event.target.value)} />
                  </label>
                  <div className="schedule-editor-field"><span>结束时间 <small>选填</small></span>
                    <TimePicker value={form.endTime} label="结束" required={false} onChange={value => set('endTime', value)} />
                  </div>
                </div>}
                {timed && <>
                  <ScheduleStepSlider label="提醒" value={form.reminder} options={reminders} onChange={value => set('reminder', value)} />
                  {legacyReminder && <p className="schedule-editor-help">
                    {/^[0-9]+$/.test(form.reminder) ? `当前提醒：提前 ${form.reminder} 分钟` : '当前提醒已保留'}
                  </p>}
                </>}
              </>}
            </section>
            <section className="schedule-editor-section" aria-label="补充信息">
              <h4><Ellipsis size={17} aria-hidden="true" />补充信息</h4>
              <div className="schedule-editor-choice-pair">
                <ScheduleStepSlider label="分类" value={form.category} options={categories} onChange={value => set('category', value)} />
                <ScheduleStepSlider label="优先级" value={form.priority} options={priorities}
                  onChange={value => set('priority', value as typeof form.priority)} />
              </div>
              <label className="schedule-editor-field">地点 <small>选填</small>
                <Input type="text" placeholder="添加地点" value={form.location} onChange={event => set('location', event.target.value)} />
              </label>
              <label className="schedule-editor-field">备注 <small>选填</small>
                <Textarea placeholder="添加补充说明" rows={2} value={form.notes} onChange={event => set('notes', event.target.value)} />
              </label>
            </section>
          </fieldset>
        </div>
        {error && <p className="orbit-inline-error" role="alert">{error}</p>}
        <footer className="schedule-editor-footer" aria-busy={saving}>
          <Button onClick={dismiss} disabled={saving}>取消</Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving || !form.title.trim()}>
            {saving ? '保存中…' : isEditing ? '保存修改' : '添加日程'}
          </Button>
        </footer>
      </div>
    </dialog>
  );
}
