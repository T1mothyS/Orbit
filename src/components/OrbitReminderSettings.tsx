import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../ui';
import { requestError } from '../utils/request-error';
import { ScheduleReminderOptions, type ScheduleReminder } from './ScheduleReminderOptions';

type ReminderDetails = ScheduleReminder & { linked: boolean; applicable: boolean };

export function OrbitReminderSettings({ id }: { id: string }) {
  const { authHeaders } = useAuth();
  const [reminder, setReminder] = useState<ReminderDetails>();
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const url = `/api/orbit/schedules/${encodeURIComponent(id)}/reminder`;

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    setReminder(undefined);
    void fetch(url, { headers: authHeaders(), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '无法读取提醒设置。');
        if (!controller.signal.aborted) setReminder(data);
      }).catch(cause => { if (!controller.signal.aborted) setError(requestError(cause, '无法读取提醒设置。', true)); });
    return () => controller.abort();
  }, [url, authHeaders, reload]);

  if (!reminder) return error
    ? <div><p role="alert">{error}</p><Button onClick={() => setReload(value => value + 1)}>重新读取提醒</Button></div>
    : <p role="status">正在读取提醒设置…</p>;

  return <ScheduleReminderOptions reminder={reminder}
    explanation={reminder.linked ? '沿用周期提醒时间，在周期提醒中调整。' :
      !reminder.applicable ? '先设置明确的日期和时间，才能自动触发提前提醒。' : undefined}
    onSave={async next => {
      const response = await fetch(url, {
        method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000), body: JSON.stringify(next),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '提醒未保存，请重试。');
      }
      setReminder(current => current && { ...current, ...next });
    }} />;
}
