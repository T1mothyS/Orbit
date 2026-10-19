import { useEffect,useState } from 'react';
import { Button,ErrorState,InlineNotice,Input,LoadingState,TimePicker,Switch,TextLink } from '../../../ui';
import { SettingRow,SettingSection } from '../SettingFields';
import { useSettingsConfirm } from '../SettingsConfirm';
import { useNotificationState,useSettingsState,useSettingsDirty } from '../SettingsState';
import type { HomeLocation } from '../types';
import { AndroidNotificationSettings } from './AndroidNotificationSettings';
import { WeeklySettings } from './WeeklySettings';

export function NotificationSettings() {
  const { owner, saved, draft, loading, pending, error, notice } = useNotificationState(), { request } = useSettingsState();
  const confirm = useSettingsConfirm();
  const [query, setQuery] = useState(''), [locations, setLocations] = useState<HomeLocation[]>([]), [searching, setSearching] = useState(false), [searchError, setSearchError] = useState('');
  useEffect(() => { void owner.ensure(); }, [owner]);
  useEffect(() => {
    if (query.trim().length < 2 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query)) { setLocations([]); setSearching(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true); setSearchError('');
      try { const response = await request('/api/weather/locations?q=' + encodeURIComponent(query.trim()), { signal: controller.signal }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '地点搜索失败'); if (!controller.signal.aborted) setLocations(result.locations || []); }
      catch (failure) { if (!controller.signal.aborted) { setLocations([]); setSearchError(failure instanceof Error ? failure.message : '地点搜索失败'); } }
      finally { if (!controller.signal.aborted) setSearching(false); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, request]);
  const [timeValidity, setTimeValidity] = useState<Record<string, boolean>>({});
  const invalidTime = Object.values(timeValidity).some(valid => !valid);
  const [timeReset, setTimeReset] = useState(0);
  useSettingsDirty('notification-time', invalidTime);
  const disabled = loading || pending > 0 || !saved;
  const updateLocation = async (location: HomeLocation | null) => { await owner.save(['homeLocation'], { homeLocation: location }); setQuery(''); setLocations([]); };
  return <><SettingSection id="notifications" title="通知与提醒" description="按渠道安排提醒；每日摘要和日报邮件共用收件邮箱。">
    {loading && <LoadingState label="加载通知设置中…" />}
    {error && <ErrorState title="通知设置需要核对" description={error} onRetry={() => void owner.reload()} />}
    {notice && <InlineNotice title={notice} />}
    <fieldset className="settings-fields" disabled={disabled}>
      <SettingRow label="提醒收件邮箱" htmlFor="settings-reminder-email" description="默认使用注册邮箱" help="每日摘要、周期提醒和日报邮件共用此邮箱。">
        <div className="settings-inline-save"><Input id="settings-reminder-email" type="email" autoComplete="email" value={draft.reminderEmail || ''} onChange={event => owner.change('reminderEmail', event.target.value)} placeholder="默认使用注册邮箱" disabled={disabled} />
        <Button loading={pending > 0} disabled={disabled} onClick={() => void owner.save(['reminderEmail'], { reminderEmail: String(draft.reminderEmail || '').trim() })}>保存邮箱</Button></div>
      </SettingRow>
      <SettingRow label="开启每日提醒" description="切换后立即保存" help="每天发送日程摘要。"><Switch label="开启每日提醒" checked={!!draft.enabled} disabled={disabled} onCheckedChange={value => void owner.save(['enabled'], { enabled: value })} /></SettingRow>
      <SettingRow label="提醒时间" description={draft.enabled ? '北京时间（UTC+8）' : '北京时间（UTC+8）；先开启每日提醒。'}>
        <div className="settings-inline-save"><TimePicker key={timeReset} label="每日提醒时间" value={`${String(draft.hour ?? 8).padStart(2, '0')}:${String(draft.minute ?? 0).padStart(2, '0')}`} disabled={disabled || !draft.enabled} onValidityChange={valid => setTimeValidity(old => old.daily === valid ? old : {...old, daily: valid})} onChange={value => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) { const [hour, minute] = value.split(':').map(Number); owner.change('hour', hour); owner.change('minute', minute); } }} />
        <Button disabled={disabled || !draft.enabled || timeValidity.daily === false} onClick={() => void owner.save(['hour', 'minute'])}>保存提醒时间</Button></div>
      </SettingRow>
      <SettingRow label="日报设置入口" description="日报邮件开关、来源接收与个性化在日报设置中管理。"><TextLink to="/settings/reports?settings=setting-notifications-1ov9hhr">打开日报邮件设置</TextLink></SettingRow>
      <SettingRow label="常驻城市或区县" htmlFor="settings-home-location" help="用于每日邮件天气和未指定地点的天气提问，只保存地点名称与坐标。">
        {draft.homeLocation && <div className="settings-location-selected"><div><strong>{draft.homeLocation.name}</strong><p className="oui-help">{[draft.homeLocation.admin1, draft.homeLocation.country].filter(Boolean).join(' · ')}</p></div><Button variant="quiet" disabled={disabled} onClick={() => void updateLocation(null)}>清除</Button></div>}
        <Input id="settings-home-location" name="home-location-search" type="search" autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} disabled={disabled} placeholder="搜索城市或区县，例如：深圳、南山" />
        {searching && <LoadingState label="搜索地点中…" />}{searchError && <InlineNotice tone="danger" title={searchError} />}
        <div className="settings-location-results" aria-label="地点搜索结果">{locations.map(location => <Button variant="quiet" key={`${location.latitude}:${location.longitude}`} disabled={disabled} onClick={() => void updateLocation(location)}>{[location.name, location.admin1, location.country].filter(Boolean).join(' · ')}</Button>)}</div>
      </SettingRow>
      <SettingRow label="通知渠道" description="站内通知与主动聊天提醒发到 Orbit 主对话；修改后点击“保存通知设置”。"><div className="settings-switches">
        <label><Switch label="邮件通知" checked={draft.emailEnabled !== false} disabled={disabled} onCheckedChange={value => owner.change('emailEnabled', value)} /><span>邮件</span></label>
        <label><Switch label="站内通知" checked={draft.inAppEnabled !== false} disabled={disabled} onCheckedChange={value => owner.change('inAppEnabled', value)} /><span>站内通知</span></label>
        <label><Switch label="浏览器前台通知" checked={draft.browserEnabled !== false} disabled={disabled} onCheckedChange={async value => { if (value && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); owner.change('browserEnabled', value); }} /><span>浏览器前台通知</span></label>
      </div></SettingRow>
      <SettingRow label="免打扰时段" description="期间的提醒会延迟到结束时间，不会被删除。"><Switch label="免打扰时段" checked={!!draft.quietHoursEnabled} disabled={disabled} onCheckedChange={value => owner.change('quietHoursEnabled', value)} />
        {draft.quietHoursEnabled && <div className="settings-time-pair"><div><TimePicker key={timeReset} label="免打扰开始时间" value={draft.quietStart ?? '22:00'} onChange={value => owner.change('quietStart', value)} onValidityChange={valid => setTimeValidity(old => old.start === valid ? old : {...old, start: valid})} /></div><span>至</span><div><TimePicker key={timeReset} label="免打扰结束时间" value={draft.quietEnd ?? '08:00'} onChange={value => owner.change('quietEnd', value)} onValidityChange={valid => setTimeValidity(old => old.end === valid ? old : {...old, end: valid})} /></div></div>}
        <div className="settings-actions"><Button variant="primary" disabled={disabled || (!!draft.quietHoursEnabled && (timeValidity.start === false || timeValidity.end === false))} loading={pending > 0} onClick={() => void owner.save(['emailEnabled', 'inAppEnabled', 'browserEnabled', 'quietHoursEnabled', 'quietStart', 'quietEnd'])}>保存通知设置</Button><Button disabled={disabled || (!owner.dirty() && !invalidTime)} onClick={async () => { if (await confirm('放弃尚未保存的通知与日报邮件修改？')) { owner.reset(); setTimeReset(value => value + 1); setTimeValidity({}); } }}>取消未保存修改</Button></div>
      </SettingRow>
    </fieldset>
    <WeeklySettings /><AndroidNotificationSettings />
    <p className="oui-help">高优先级日程邮件是固定规则，不受邮件开关、免打扰和“开启每日提醒”影响。官方发件邮箱：aicalendarofficial@163.com</p>
  </SettingSection></>;
}
