import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { Button,Checkbox,Input,Select } from '../../../ui';
import { SettingRow } from "../SettingFields";
import { useSettingsDirty,useSettingsRequest } from '../SettingsState';
interface WeeklyPreferences {
    enabled: boolean;
    weekday: number;
    hour: number;
    minute: number;
    timezone: string;
    runnerEnabled: boolean;
    emailRunnerEnabled: boolean;
}
export function WeeklySettings() {
    const settingsFetch = useSettingsRequest();
    const { authHeaders } = useAuth();
    const [data, setData] = useState<WeeklyPreferences | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [savedWeekly,setSavedWeekly]=useState('');
    useSettingsDirty('weekly',!!data && JSON.stringify(data)!==savedWeekly);
    const load = () => { setError(''); void settingsFetch('/api/orbit/weekly/preferences', { headers: authHeaders() }).then(async (r) => { const d = await r.json(); if (!r.ok)
        throw new Error(d.error || '周报设置加载失败'); setData(d);setSavedWeekly(JSON.stringify(d)); }).catch(e => setError(e.message)); };
    useEffect(load, [authHeaders]);
    const save = async () => { if (!data)
        return; setBusy(true); setError(''); try {
        const r = await settingsFetch('/api/orbit/weekly/preferences', { method: 'PATCH', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: data.enabled, weekday: data.weekday, hour: data.hour, minute: data.minute }) });
        const d = await r.json();
        if (!r.ok)
            throw new Error(d.error || '周报设置保存失败');
        setData(d);setSavedWeekly(JSON.stringify(d));
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '周报设置保存失败');
    }
    finally {
        setBusy(false);
    } };
    return <SettingRow label="Orbit Weekly" description="总结最近七天的执行、知识积累与 AI 协作；自动投递默认关闭。使用已开启的邮件及站内通知渠道。">{data ? <><label><Checkbox checked={data.enabled} disabled={busy} onCheckedChange={value => setData({ ...data, enabled: value })} label="开启自动周报"/> 开启自动周报</label><div className="settings-time-pair"><div><Select label="周报星期" disabled={busy} value={String(data.weekday)} onValueChange={value => setData({...data,weekday:Number(value)})} options={['周日','周一','周二','周三','周四','周五','周六'].map((label,i)=>({value:String(i),label}))} /></div><div><Input type="time" aria-label="周报时间" disabled={busy} value={`${String(data.hour).padStart(2, '0')}:${String(data.minute).padStart(2, '0')}`} onChange={e => { const [hour, minute] = e.target.value.split(':').map(Number); if (Number.isFinite(hour) && Number.isFinite(minute))
        setData({ ...data, hour, minute }); }}/></div><p className="oui-help">{data.timezone}</p></div><Button type="button" disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存周报设置'}</Button>{!data.runnerEnabled && <p role="status">自动报告服务未启用；设置会保留，可在统计页手动生成。</p>}{data.enabled && !data.emailRunnerEnabled && <p className="settings-help">邮件发送服务未启用时，邮件会等待队列处理；站内投递独立运行。</p>}<p><Link to="/project?view=statistics">查看个人活动报告 →</Link></p></> : <p role="status">正在读取周报设置…</p>}{error && <p role="alert">{error}<Button type="button" onClick={load}>重新读取</Button></p>}</SettingRow>;
}
