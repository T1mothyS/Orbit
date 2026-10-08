import { Bell, Calendar, CheckCircle2, Clock, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SCHEDULE_CATEGORIES } from '../../utils/scheduleCategories';
import { CATEGORY_COLORS, formatScheduleDate, formatTime, PRIORITY_COLORS, toDateKey, shiftDateKey, linkedEndTime } from './schedule-presentation';
import type { Schedule } from './schedule-types';
import { useDialogLifecycle } from '../../hooks/useDialogLifecycle';

function SmartTimePicker({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  const currentHour = parseInt(value?.split(':')[0] || '0');
  const currentMinute = parseInt(value?.split(':')[1] || '0');
  const [selHour, setSelHour] = useState(currentHour);
  const [selMinute, setSelMinute] = useState(currentMinute);
  const hourRef = useRef<HTMLSelectElement>(null);
  const minRef = useRef<HTMLSelectElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { if (open) hourRef.current?.focus(); }, [open]);
  const dismiss = () => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); };

  const handleConfirm = () => {
    onChange(`${String(selHour).padStart(2, '0')}:${String(selMinute).padStart(2, '0')}`);
    dismiss();
  };

  return (
    <div className="smart-time-picker relative flex-1" onBlur={event => {
      if (open && event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={event => {
      if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
    }}>
      <button
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        onClick={() => {
          if (open) dismiss();
          else { setSelHour(currentHour); setSelMinute(currentMinute); setOpen(true); }
        }}
        className="w-full px-3 py-2 rounded-lg text-sm text-left flex items-center justify-between transition-all"
        style={{
          backgroundColor: 'var(--td-bg-color-component)',
          color: 'var(--td-text-color-primary)',
          border: `1.5px solid ${open ? 'var(--td-brand-color)' : 'var(--td-component-stroke)'}`,
        }}
      >
        <div className="flex items-center gap-2">
          {label && <span className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>{label}</span>}
          <span className="font-mono">{value || '00:00'}</span>
        </div>
        <Clock aria-hidden="true" className="w-4 h-4" style={{ color: 'var(--td-text-color-secondary)' }} />
      </button>

      {open && (
        <div
          role="group"
          aria-label={`${label || ''}时间选择`}
          className="smart-time-panel absolute top-full left-0 mt-1 z-50 rounded-xl shadow-2xl overflow-hidden"
          style={{
            backgroundColor: 'var(--td-bg-color-container)',
            border: '1px solid var(--td-component-stroke)',
            width: '220px',
          }}
        >
          <div className="flex">
            {/* 小时滚轮 */}
            <div className="flex-1 border-r" style={{ borderColor: 'var(--td-component-stroke)' }}>
              <div className="px-2 py-1.5 text-xs text-center font-medium" style={{ color: 'var(--td-text-color-secondary)', borderBottom: '1px solid var(--td-component-stroke)' }}>
                时
              </div>
              <select ref={hourRef} size={5} aria-label={`${label || ''}时间：小时`} value={selHour}
                className="smart-time-list" onChange={event => setSelHour(Number(event.target.value))}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); minRef.current?.focus(); } }}>
                {hours.map(h => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                ))}
              </select>
            </div>
            {/* 分钟滚轮 */}
            <div className="flex-1">
              <div className="px-2 py-1.5 text-xs text-center font-medium" style={{ color: 'var(--td-text-color-secondary)', borderBottom: '1px solid var(--td-component-stroke)' }}>
                分
              </div>
              <select ref={minRef} size={5} aria-label={`${label || ''}时间：分钟`} value={selMinute}
                className="smart-time-list" onChange={event => setSelMinute(Number(event.target.value))}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); confirmRef.current?.focus(); } }}>
                {minutes.map(m => (
                  <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                ))}
              </select>
            </div>
          </div>
          {/* 确认按钮 */}
          <div className="px-3 py-2 border-t flex gap-2" style={{ borderColor: 'var(--td-component-stroke)' }}>
            <button
              type="button"
              onClick={dismiss}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}
            >
              取消
            </button>
            <button
              type="button"
              ref={confirmRef}
              onClick={handleConfirm}
              className="flex-1 py-1.5 rounded-lg text-xs font-medium"
              style={{ backgroundColor: 'var(--td-brand-color)', color: '#fff' }}
            >
              确定
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReminderPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(parseInt(value) || 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const presetOptions = [
    { label: '不提醒', value: '' },
    { label: '5分钟', value: '5' },
    { label: '10分钟', value: '10' },
    { label: '15分钟', value: '15' },
    { label: '30分钟', value: '30' },
    { label: '1小时', value: '60' },
    { label: '2小时', value: '120' },
    { label: '1天', value: '1440' },
  ];

  const isCustom = value && !presetOptions.find(o => o.value === value);

  const formatReminder = (mins: string) => {
    if (!mins) return '不提醒';
    const m = parseInt(mins);
    if (m >= 1440) return `${m / 1440}天`;
    if (m >= 60) return `${m / 60}小时`;
    return `${m}分钟`;
  };

  return (
    <div className="relative" ref={ref} onKeyDown={event => { if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); event.currentTarget.querySelector<HTMLButtonElement>('button')?.focus(); } }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 rounded-lg text-sm text-left flex items-center justify-between transition-all"
        style={{
          backgroundColor: 'var(--td-bg-color-component)',
          color: 'var(--td-text-color-primary)',
          border: `1.5px solid ${open ? 'var(--td-brand-color)' : 'var(--td-component-stroke)'}`,
        }}
      >
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4" style={{ color: 'var(--td-text-color-secondary)' }} />
          <span>{isCustom ? `提前${formatReminder(value)}` : formatReminder(value)}</span>
        </div>
      </button>

      {open && (
        <div
          className="absolute top-full left-0 mt-1 z-50 rounded-xl shadow-2xl overflow-hidden"
          style={{
            backgroundColor: 'var(--td-bg-color-container)',
            border: '1px solid var(--td-component-stroke)',
            width: '180px',
          }}
        >
          {/* 预设选项 */}
          <div className="p-2">
            <div className="text-xs mb-1.5 px-1" style={{ color: 'var(--td-text-color-secondary)' }}>快速选择</div>
            <div className="grid grid-cols-2 gap-1">
              {presetOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { onChange(opt.value); setOpen(false); }}
                  className="py-1.5 px-2 rounded-lg text-xs transition-all flex items-center gap-1"
                  style={{
                    backgroundColor: value === opt.value ? 'var(--td-brand-color)' : 'var(--td-bg-color-component)',
                    color: value === opt.value ? '#fff' : 'var(--td-text-color-primary)',
                  }}
                >
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>
          {/* 自定义输入 */}
          <div className="px-3 py-2 border-t" style={{ borderColor: 'var(--td-component-stroke)' }}>
            <div className="text-xs mb-1.5 px-1" style={{ color: 'var(--td-text-color-secondary)' }}>自定义分钟数</div>
            <div className="flex gap-1.5">
              <input
                type="number"
                min="1"
                max="10080"
                value={customMinutes || ''}
                onChange={e => setCustomMinutes(parseInt(e.target.value) || 0)}
                placeholder="输入分钟"
                className="flex-1 px-2 py-1.5 rounded-lg text-xs outline-none"
                style={{
                  backgroundColor: 'var(--td-bg-color-component)',
                  color: 'var(--td-text-color-primary)',
                  border: '1px solid var(--td-component-stroke)',
                }}
              />
              <button
                onClick={() => {
                  if (customMinutes > 0) {
                    onChange(String(customMinutes));
                    setOpen(false);
                  }
                }}
                className="px-2 py-1.5 rounded-lg text-xs font-medium"
                style={{ backgroundColor: 'var(--td-brand-color)', color: '#fff' }}
              >
                设置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
    endTime: editingSchedule?.type === 'event' && editingSchedule.end_time && !editingSchedule.all_day
      ? formatTime(editingSchedule.end_time)
      : '10:00',
    endDate: editingSchedule?.end_time && !editingSchedule.all_day
      ? toDateKey(new Date(editingSchedule.end_time))
      : editingSchedule ? editingSchedule.start_time.split('T')[0] : toDateKey(defaultDate),
    all_day: editingSchedule?.all_day || false,
    location: editingSchedule?.location || '',
    category: editingSchedule?.category || (SCHEDULE_CATEGORIES.some(category => category.id === defaultCategory) ? defaultCategory! : 'other'),
    priority: (editingSchedule?.priority || 'medium') as 'high' | 'medium' | 'low',
    notes: editingSchedule?.notes || '',
    reminder: (editingSchedule?.reminders?.[0] || '') as string,
    calendarId: editingSchedule?.calendar_id || 'personal',
    // 循环设置
    repeat: (editingSchedule?.is_repeated ? (editingSchedule as any).repeat_rule || 'daily' : '') as '' | 'daily' | 'weekly' | 'monthly',
  });

  const initialForm = useRef(JSON.stringify(form));
  const saveFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => { if (!saving && saveFocus.current?.isConnected) { saveFocus.current.focus({preventScroll:true}); saveFocus.current = null; } }, [saving]);
  const dismiss = () => {
    if (savingRef.current) return;
    if (confirmDiscard && initialForm.current !== JSON.stringify(form) && !window.confirm('放弃本次未保存的编辑？')) return;
    onClose();
  };
  const set = (k: string, v: any) => {
    setError('');
    setForm(prev => ({ ...prev, [k]: v, ...(k === 'date' ? {
      endDate: shiftDateKey(v, Math.max(0, Math.round((Date.parse(`${prev.endDate}T12:00Z`) - Date.parse(`${prev.date}T12:00Z`)) / 86400000) || 0)),
    } : {}) }));
  };
  const selectedDate = formatScheduleDate(form.date);
  const isUnscheduled = form.type === 'todo' && form.isUnscheduled;

  // 类别颜色配置
  const catColor = CATEGORY_COLORS[form.category] || '#6B7280';

  const handleSave = async () => {
    if (savingRef.current || !form.title.trim()) return;
    if (!isUnscheduled && (!/^\d{4}-\d{2}-\d{2}$/.test(form.date) || Number.isNaN(Date.parse(form.date)))) {
      setError('请选择执行日期'); return;
    }
    const startTime = isUnscheduled
      ? editingSchedule?.start_time || new Date().toISOString()
      : form.all_day
      ? `${form.date}T00:00:00`
      : `${form.date}T${form.startTime}:00`;
    // 待办是时间点；结束时间只属于有持续时长的事件。
    const endTime = form.type === 'todo' || isUnscheduled || form.all_day
      ? undefined
      : `${form.endDate || form.date}T${form.endTime}:00`;

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
      location: form.location || undefined,
      notes: form.notes || undefined,
      category: form.category,
      priority: form.priority,
      reminders: isUnscheduled ? [] : (form.reminder ? [form.reminder] : []),
      is_repeated: isUnscheduled ? false : !!form.repeat,
      repeat_rule: isUnscheduled ? undefined : (form.repeat || undefined),
    }); } catch (cause) {
      setError(cause instanceof Error && cause.name === 'TimeoutError'
        ? '保存结果暂未确认，输入已保留。请先重新加载核对，避免重复创建。'
        : cause instanceof TypeError ? '网络连接失败，输入已保留。请先核对日程，再重试保存。'
        : cause instanceof Error ? cause.message : '保存失败，输入已保留，请重试。');
    } finally { savingRef.current = false; setSaving(false); }
  };

  const priorityConfig = PRIORITY_COLORS[form.priority];

  // 类别选项
  const categoryOptions = SCHEDULE_CATEGORIES.map(category => ({
    key: category.id,
    label: category.name,
    color: category.color,
  }));

  return (
    <dialog
      ref={dialogRef}
      aria-label={isEditing ? '编辑日程' : '新增日程'}
      className="orbit-dialog-viewport fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
      onCancel={event => { event.preventDefault(); event.stopPropagation(); dismiss(); }}
      onClick={event => { if (event.target === event.currentTarget) dismiss(); }}
    >
      <div
        className="schedule-form-modal rounded-2xl p-6 w-full max-w-md shadow-2xl"
        style={{ backgroundColor: 'var(--td-bg-color-container)' }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="flex items-center justify-between mb-5">
          <h3 className="schedule-form-heading" style={{ color: 'var(--td-text-color-primary)' }}>
            {isEditing ? '编辑日程' : '新增日程'}
          </h3>
          <button onClick={dismiss} disabled={saving} aria-label="关闭日程编辑" className="p-1 rounded-lg hover:opacity-60">
            <X className="w-4 h-4" style={{ color: 'var(--td-text-color-secondary)' }} />
          </button>
        </div>

        <div className="schedule-form-scroll">
        <fieldset disabled={saving} className="space-y-4 schedule-form-fields">
          {/* 类型切换 */}
          <div className="flex gap-2">
            {(['event', 'todo'] as const).map(t => (
              <button
                key={t}
                onClick={() => setForm(prev => ({
                  ...prev,
                  type: t,
                  isUnscheduled: t === 'todo' ? prev.isUnscheduled : false,
                }))}
                className="schedule-type-option flex-1 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  backgroundColor: form.type === t ? 'var(--td-brand-color)' : 'var(--td-bg-color-component)',
                  color: form.type === t ? '#fff' : 'var(--td-text-color-secondary)',
                }}
              >
                {t === 'event' ? <><Calendar size={16} />日程</> : <><CheckCircle2 size={16} />待办</>}
              </button>
            ))}
          </div>

          {/* 标题 */}
          <input
            type="text"
            placeholder="输入日程标题..."
            aria-label="日程标题"
            value={form.title}
            onChange={e => set('title', e.target.value)}
            className="schedule-title-input w-full px-3 py-2.5 rounded-lg outline-none"
            style={{
              backgroundColor: 'var(--td-bg-color-component)',
              color: 'var(--td-text-color-primary)',
              border: '1.5px solid var(--td-component-stroke)',
            }}
          />

          {/* 日期 - 待办可以切换为无固定期限 */}
          <div className="schedule-date-field">
            <div
              className={`relative overflow-hidden rounded-lg transition-all ${isUnscheduled ? 'is-unscheduled' : 'cursor-pointer hover:border-brand-color'}`}
              style={{
                backgroundColor: 'var(--td-bg-color-component)',
                border: '1.5px solid var(--td-component-stroke)',
              }}
              onClick={() => {
                if (isUnscheduled) return;
                const input = document.getElementById('schedule-date-input') as HTMLInputElement;
                input?.showPicker?.();
              }}
            >
              {!isUnscheduled && (
                <input
                  id="schedule-date-input"
                  type="date"
                  value={form.date}
                  onChange={e => set('date', e.target.value)}
                  className="w-full px-3 py-2 text-sm outline-none cursor-pointer"
                  style={{
                    backgroundColor: 'transparent',
                    color: 'var(--td-text-color-primary)',
                    position: 'absolute',
                    opacity: 0,
                    width: '100%',
                    height: '100%',
                    top: 0,
                    left: 0,
                  }}
                />
              )}
              <div className="schedule-date-summary">
                <Calendar className="w-5 h-5" />
                <div>
                  <strong>{isUnscheduled ? '无固定期限' : selectedDate.date}</strong>
                  {isUnscheduled ? <span>完成前持续保留，不绑定具体日期</span> : selectedDate.weekday && <span>{selectedDate.weekday}</span>}
                </div>
                {!isUnscheduled && selectedDate.isToday && <em>今天</em>}
              </div>
            </div>
            {form.type === 'todo' && (
              <label className="schedule-unscheduled-toggle">
                <input
                  type="checkbox"
                  checked={form.isUnscheduled}
                  onChange={event => setForm(prev => ({
                    ...prev,
                    isUnscheduled: event.target.checked,
                    date: event.target.checked ? prev.date : '',
                    reminder: event.target.checked ? '' : prev.reminder,
                    repeat: event.target.checked ? '' : prev.repeat,
                  }))}
                />
                <span>
                  <strong>无固定期限待办</strong>
                  <small>暂不绑定执行日期，之后可以再切回日期待办</small>
                </span>
              </label>
            )}
          </div>

          {/* 时间（仅日程类型） */}
          {form.type === 'event' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.all_day}
                  onChange={e => set('all_day', e.target.checked)}
                />
                <span className="text-sm" style={{ color: 'var(--td-text-color-secondary)' }}>全天事件</span>
              </label>
              {!form.all_day && (
                <div className="flex gap-3 items-center">
                  <SmartTimePicker
                    value={form.startTime}
                    onChange={v => {
                      setError('');
                      setForm(prev => ({ ...prev, startTime: v, ...linkedEndTime(prev.date, v, prev.endDate, prev.endTime) }));
                    }}
                    label="开始"
                  />
                  <span style={{ color: 'var(--td-text-color-secondary)', fontSize: '12px' }}>至</span>
                  <SmartTimePicker
                    value={form.endTime}
                    onChange={v => set('endTime', v)}
                    label="结束"
                  />
                </div>
              )}
            </div>
          )}

          {form.type === 'event' && !form.all_day && form.endDate && form.endDate !== form.date && <p className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>结束日期：{form.endDate}</p>}

          {/* 待办时间点选择器，不设置持续时长 */}
          {form.type === 'todo' && !isUnscheduled && (
            <div>
              <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
                待办时间点
              </div>
              <div className="flex gap-3 items-center">
                <SmartTimePicker
                  value={form.startTime}
                  onChange={v => set('startTime', v)}
                  label="时间点"
                />
                <span style={{ color: 'var(--td-text-color-secondary)', fontSize: '12px' }}>不设置持续时长</span>
              </div>
            </div>
          )}

          {/* 提前提醒 - 使用新的ReminderPicker */}
          {!isUnscheduled && <div>
            <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
              提前提醒
            </div>
            <ReminderPicker
              value={form.reminder}
              onChange={v => set('reminder', v)}
            />
          </div>}

          <div className="schedule-advanced-options schedule-form-details">
          {/* 地点 */}
          <input
            type="text"
            placeholder="添加地点（可选）"
            value={form.location}
            onChange={e => set('location', e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
            style={{
              backgroundColor: 'var(--td-bg-color-component)',
              color: 'var(--td-text-color-primary)',
              border: '1.5px solid var(--td-component-stroke)',
            }}
          />

          {/* 分类选择 - 横向标签风格 */}
          <div>
            <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
              日程分类
            </div>
            <div className="flex flex-wrap gap-2">
              {categoryOptions.map(opt => (
                <button
                  key={opt.key}
                  onClick={() => set('category', opt.key)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1"
                  style={{
                    backgroundColor: form.category === opt.key ? opt.color + '20' : 'var(--td-bg-color-component)',
                    color: form.category === opt.key ? opt.color : 'var(--td-text-color-secondary)',
                    border: `1.5px solid ${form.category === opt.key ? opt.color : 'transparent'}`,
                  }}
                >
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 优先级选择 */}
          <div>
            <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
              优先级
            </div>
            <div className="flex gap-2">
              {[
                { key: 'high', label: '高', bg: '#FEF2F2', color: '#EF4444' },
                { key: 'medium', label: '中', bg: '#FFFBEB', color: '#F59E0B' },
                { key: 'low', label: '低', bg: '#F0FDF4', color: '#10B981' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => set('priority', opt.key)}
                  className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundColor: form.priority === opt.key ? opt.bg : 'var(--td-bg-color-component)',
                    color: form.priority === opt.key ? opt.color : 'var(--td-text-color-secondary)',
                    border: `1.5px solid ${form.priority === opt.key ? opt.color : 'transparent'}`,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 备注 */}
          <textarea
            placeholder="添加备注（可选）"
            value={form.notes}
            onChange={e => set('notes', e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
            style={{
              backgroundColor: 'var(--td-bg-color-component)',
              color: 'var(--td-text-color-primary)',
              border: '1.5px solid var(--td-component-stroke)',
            }}
          />

          {/* 循环设置 */}
          {!isUnscheduled && <div>
            <div className="text-xs mb-1.5 font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
              循环重复
            </div>
            <div className="flex gap-2">
              {[
                { key: '', label: '不重复', color: '#6B7280' },
                { key: 'daily', label: '每日', color: '#3B82F6' },
                { key: 'weekly', label: '每周', color: '#10B981' },
                { key: 'monthly', label: '每月', color: '#8B5CF6' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => set('repeat', opt.key)}
                  className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                  style={{
                    backgroundColor: form.repeat === opt.key ? opt.color + '20' : 'var(--td-bg-color-component)',
                    color: form.repeat === opt.key ? opt.color : 'var(--td-text-color-secondary)',
                    border: `1.5px solid ${form.repeat === opt.key ? opt.color : 'transparent'}`,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>}
          </div>
        </fieldset>
        </div>
        {error && <p className="orbit-inline-error" role="alert">{error}</p>}
        <div className="flex gap-2 mt-6" aria-busy={saving}>
          <button
            onClick={dismiss}
            disabled={saving}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--td-bg-color-component)', color: 'var(--td-text-color-secondary)' }}
          >
            取消
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving || !form.title.trim()}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all"
            style={{
              backgroundColor: form.title.trim() ? 'var(--td-brand-color)' : 'var(--td-bg-color-component)',
              color: form.title.trim() ? '#fff' : 'var(--td-text-color-disabled)',
            }}
          >
            {saving ? '保存中…' : isEditing ? '保存修改' : '添加日程'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
