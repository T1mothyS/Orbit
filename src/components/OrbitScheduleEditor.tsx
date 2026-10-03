import { requestError } from '../utils/request-error';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ScheduleDetailModal } from './calendar/ScheduleDetailModal';
import { ScheduleFormModal } from './calendar/ScheduleFormModal';
import type { Schedule } from './calendar/schedule-types';
import { OrbitReminderSettings } from './OrbitReminderSettings';
import { OrbitDialog } from './OrbitDialog';
export function OrbitScheduleEditor({ id, onClose, onSaved,onChat }: {
    id: string;
    onClose: () => void;
    onSaved: () => void;
    onChat?:(id:string,title:string)=>void;
}) {
    const { authHeaders } = useAuth();
    const [schedule, setSchedule] = useState<Schedule | null>(null);
    const [editing, setEditing] = useState(false);
    const [date, setDate] = useState('');
    const dateInput = useRef<HTMLInputElement>(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [expectedState, setExpectedState] = useState('');
    const initialDate = useRef('');
    const savingRef = useRef(false);
    const linked = id.startsWith('reminder-cycle:');
    useEffect(() => {
        let live = true;
        void fetch(`/api/schedules/${encodeURIComponent(id)}`, { headers: authHeaders() }).then(async (r) => { const data = await r.json(); if (!r.ok)
            throw new Error(data.error); if (live) {
            setSchedule(data.schedule);
            setDate(data.schedule.start_time.slice(0, 10));
            initialDate.current = data.schedule.start_time.slice(0, 10);
            setExpectedState(data.expectedState);
        } }).catch(e => { if (live)
            setError(e.message); });
        return () => { live = false; };
    }, [id, authHeaders]);
    const mutate = async (method: string, body?: unknown, suffix = '') => {
        if (savingRef.current)
            return;
        savingRef.current = true;
        setSaving(true);
        setError('');
        try {
            const res = await fetch(`/api/schedules/${encodeURIComponent(id)}${suffix}`, { method, headers: { ...authHeaders(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            const data = await res.json();
            if (!res.ok)
                throw new Error(data.error || '保存失败');
            onSaved();
            onClose();
        }
        catch (e) {
            if (!linked) throw e;
            setError(requestError(e, '保存失败', true));
        }
        finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    if (linked || !schedule)
        return <OrbitDialog label="本周期安排日期" busy={saving} error={error} onClose={onClose}
          canClose={() => date === initialDate.current || window.confirm('有未保存的安排日期，确定放弃吗？')}>
          {close => <section className="orbit-modal">
            <button type="button" className="orbit-modal-close" aria-label="关闭" onClick={close} disabled={saving}>×</button>
            <h3>{schedule?.title || '打开事项'}</h3>
            {error && <p className="orbit-inline-error" role="alert">{error}</p>}
            {!schedule ? !error && <p role="status">正在加载…</p> : <>
              <p className="orbit-cycle-description">{schedule.description}</p>
              <fieldset className="orbit-form-fields" disabled={saving}>
                <label>本周期安排日期<input ref={dateInput} aria-label="本周期安排日期" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
                <p>只调整本周期的安排日期。</p>
                <button type="button" className="primary-button" disabled={!date} onClick={() => { void mutate('PATCH', { date: dateInput.current?.value || date, expectedState }, '/planned-date'); }}>{saving ? '保存中…' : '保存安排日期'}</button>
                <button type="button" className="secondary-button" onClick={() => { void mutate('PATCH', { date: null, expectedState }, '/planned-date'); }}>恢复按到期日安排</button>
                <OrbitReminderSettings id={id} />
                {onChat && <button type="button" className="orbit-scope-chat" onClick={() => onChat(id, schedule.title)}>围绕此事项聊天</button>}
              </fieldset>
              <Link to="/reminders">编辑周期规则或登记完成</Link>
            </>}
          </section>}
        </OrbitDialog>;
    return <>
    {editing ? <ScheduleFormModal defaultDate={new Date(schedule.start_time)} editingSchedule={schedule} onClose={onClose} onSave={fields => mutate('PATCH', { ...fields, expectedState })}/> : <ScheduleDetailModal closeAfterAction={false} schedule={schedule} onClose={onClose} onEdit={() => setEditing(true)} onDelete={() => mutate('DELETE')} onToggle={() => mutate('POST', {}, '/toggle')} extraActions={<><OrbitReminderSettings id={id}/>{onChat&&<button type="button" className="orbit-scope-chat" onClick={()=>onChat(id,schedule.title)}>围绕此事项聊天</button>}</>}/>}
    {error && <div className="orbit-edit-error" role="alert">{error}</div>}
  </>;
}
