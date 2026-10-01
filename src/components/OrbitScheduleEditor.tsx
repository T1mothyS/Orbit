import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ScheduleDetailModal } from './calendar/ScheduleDetailModal';
import { ScheduleFormModal } from './calendar/ScheduleFormModal';
import type { Schedule } from './calendar/schedule-types';
import { OrbitReminderSettings } from './OrbitReminderSettings';
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
    const linked = id.startsWith('reminder-cycle:');
    useEffect(() => {
        let live = true;
        void fetch(`/api/schedules/${encodeURIComponent(id)}`, { headers: authHeaders() }).then(async (r) => { const data = await r.json(); if (!r.ok)
            throw new Error(data.error); if (live) {
            setSchedule(data.schedule);
            setDate(data.schedule.start_time.slice(0, 10));
            setExpectedState(data.expectedState);
        } }).catch(e => { if (live)
            setError(e.message); });
        return () => { live = false; };
    }, [id, authHeaders]);
    const mutate = async (method: string, body?: unknown, suffix = '') => {
        if (saving)
            return;
        setSaving(true);
        setError('');
        try {
            const res = await fetch(`/api/schedules/${encodeURIComponent(id)}${suffix}`, { method, headers: { ...authHeaders(), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
            const data = await res.json();
            if (!res.ok)
                throw new Error(data.error || '保存失败');
            onSaved();
            onClose();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : '保存失败');
        }
        finally {
            setSaving(false);
        }
    };
    if (linked || !schedule)
        return <div className="orbit-modal-backdrop" onMouseDown={onClose}><section className="orbit-modal" role="dialog" aria-modal="true" aria-label="本周期安排日期" onMouseDown={e => e.stopPropagation()}><button type="button" className="orbit-modal-close" aria-label="关闭" onClick={onClose}>×</button><h3>{schedule?.title || '打开事项'}</h3>{error ? <p role="alert">{error}</p> : !schedule ? <p>正在加载…</p> : <><p className="orbit-cycle-description">{schedule.description}</p><label>本周期安排日期<input ref={dateInput} aria-label="本周期安排日期" type="date" value={date} onChange={e => setDate(e.target.value)}/></label><p>原到期日、提醒和未来周期规则保持不变。</p><button type="button" className="primary-button" disabled={saving || !date} onClick={() => { void mutate('PATCH', { date: dateInput.current?.value || date, expectedState }, '/planned-date'); }}>{saving ? '保存中…' : '保存安排日期'}</button><button type="button" onClick={() => { void mutate('PATCH', { date: null, expectedState }, '/planned-date'); }} disabled={saving}>恢复按到期日安排</button><OrbitReminderSettings id={id}/>{onChat&&<button type="button" className="orbit-scope-chat" onClick={()=>onChat(id,schedule.title)}>围绕此事项聊天</button>}<Link to="/reminders">前往周期提醒登记完成或编辑规则</Link></>}</section></div>;
    return <>
    {editing ? <ScheduleFormModal defaultDate={new Date(schedule.start_time)} editingSchedule={schedule} onClose={onClose} onSave={fields => { void mutate('PATCH', { ...fields, expectedState }); }}/> : <ScheduleDetailModal closeAfterAction={false} schedule={schedule} onClose={onClose} onEdit={() => setEditing(true)} onDelete={() => { if (window.confirm('确认删除这个事项？'))
        void mutate('DELETE'); }} onToggle={() => { void mutate('POST', {}, '/toggle'); }} extraActions={<><OrbitReminderSettings id={id}/>{onChat&&<button type="button" className="orbit-scope-chat" onClick={()=>onChat(id,schedule.title)}>围绕此事项聊天</button>}</>}/>}
    {error && <div className="orbit-edit-error" role="alert">{error}</div>}
  </>;
}
