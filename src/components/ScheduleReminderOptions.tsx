import { useId, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { Button, Input } from '../ui';
import { requestError } from '../utils/request-error';
import '../styles/chat-schedule-detail.css';

export type ScheduleReminder = { enabled: boolean; minutes: number };

const options = [
  { minutes: null, label: '无需提醒' },
  { minutes: 15, label: '提前 15 分钟' },
  { minutes: 60, label: '提前 1 小时' },
];

function customMinutes(minutes: number | null) {
  return options.some(option => option.minutes === minutes) ? '' : String(minutes);
}

export function ScheduleReminderOptions({ reminder, explanation, onSave }: {
  reminder: ScheduleReminder;
  explanation?: string;
  onSave: (reminder: ScheduleReminder) => Promise<void>;
}) {
  const id = useId();
  const current = reminder.enabled ? reminder.minutes : null;
  const [minutes, setMinutes] = useState(() => customMinutes(current));
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean; invalid?: boolean }>();

  async function save(next: number | null) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setFeedback(undefined);
    try {
      await onSave({ enabled: next !== null, minutes: next ?? reminder.minutes });
      setMinutes(customMinutes(next));
      setFeedback({ text: '提醒已保存' });
    } catch (error) {
      setFeedback({ text: requestError(error, '提醒未保存，请重试。', true), error: true });
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return <section className="orbit-reminder" aria-label="主动聊天提醒">
    <div className="orbit-reminder-row">
      <h2 className="orbit-reminder-heading"><Bell size={17} aria-hidden="true" />主动聊天提醒</h2>
      {!explanation && <form className="orbit-reminder-options" aria-label="提醒时间" aria-busy={saving} onSubmit={event => {
        event.preventDefault();
        if (busy.current) return;
        const value = minutes.trim();
        if (!/^\d+$/.test(value) || Number(value) > 10080) {
          setFeedback({ text: '请输入 0–10080 之间的整数分钟。', invalid: true, error: true });
          return;
        }
        void save(Number(value));
      }}>
        {options.map(option => <Button key={option.label} aria-disabled={saving || undefined}
          aria-pressed={current === option.minutes} onClick={() => void save(option.minutes)}>{option.label}</Button>)}
        <label className="orbit-reminder-custom">
          <Input aria-label="自定义提醒分钟数" aria-invalid={feedback?.invalid || undefined}
            aria-describedby={feedback?.invalid ? id + '-feedback' : id + '-help'}
            inputMode="numeric" enterKeyHint="done" placeholder="自定义" value={minutes} readOnly={saving}
            data-current={(minutes !== '' && minutes === customMinutes(current)) || undefined}
            onChange={event => { setMinutes(event.target.value); setFeedback(undefined); }} />
          <span aria-hidden="true">分钟</span>
        </label>
      </form>}
    </div>
    <p className="orbit-reminder-help" id={id + '-help'}>{explanation || '自定义按回车保存。需开启对话列表中的「主动聊天提醒」。'}</p>
    {!explanation && <div aria-live="polite">
      {saving && <p className="orbit-reminder-feedback">正在保存提醒…</p>}
      {feedback && <p id={id + '-feedback'} className={`orbit-reminder-feedback${feedback.error ? ' is-error' : ''}`}>{feedback.text}</p>}
    </div>}
  </section>;
}
