import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Switch } from 'tdesign-react';
import { SettingRow } from '../SettingRow';
import { SettingSection } from '../SettingSection';
import { loadNotificationPreferences, saveAndReloadNotificationPreferences } from '../../../services/notification-preferences';
import type { SettingsAuthHeaders } from '../types';

export function ReportEmailSettings({ authHeaders }: { authHeaders: SettingsAuthHeaders }) {
  const [enabled, setEnabled] = useState(false), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await loadNotificationPreferences(authHeaders()); setEnabled(data.preference?.reportEmailEnabled === true); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '读取日报邮件设置失败'); }
    finally { setLoading(false); }
  }, [authHeaders]);
  useEffect(() => { void load(); }, [load]);
  const save = async (value: boolean) => {
    setBusy(true); setError('');
    try {
      const data = await saveAndReloadNotificationPreferences({ reportEmailEnabled: value }, authHeaders());
      const actual = data.preference?.reportEmailEnabled === true;
      setEnabled(actual);
      if (actual !== value) throw new Error('服务器保存状态与当前选择不一致，请重试');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '保存日报邮件设置失败'); }
    finally { setBusy(false); }
  };
  return <SettingSection id="report-email" title="日报邮件">
    <SettingRow id="setting-notifications-1ov9hhr" label="日报邮件" description="独立于每日摘要、提醒渠道和免打扰。切换只保存设置，不补发历史日报。">
      <Switch aria-label="日报邮件" aria-checked={enabled} value={enabled} disabled={loading || busy || !!error} onChange={value => void save(Boolean(value))} />
      {loading && <p role="status" className="settings-help">读取邮件设置中…</p>}
      {error && <p role="alert" className="settings-error-text">{error}<Button variant="outline" onClick={() => void load()}>重试邮件设置</Button></p>}
      <p className="settings-note">收件邮箱与每日摘要、周期提醒共用，修改会影响这些邮件。<Link to="/reports?settings=setting-notifications-x4nqrq">编辑共享收件邮箱</Link></p>
    </SettingRow>
  </SettingSection>;
}
