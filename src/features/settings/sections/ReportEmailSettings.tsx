import { useEffect } from 'react';
import { Button,InlineNotice,LoadingState,Switch,TextLink } from '../../../ui';
import { SettingRow,SettingSection } from '../SettingFields';
import { useNotificationState } from '../SettingsState';
export function ReportEmailSettings() {
  const { owner, saved, draft, pending, loading, error, notice } = useNotificationState();
  useEffect(() => { void owner.ensure(); }, [owner]);
  return <SettingSection id="report-email" title="日报邮件"><SettingRow id="setting-notifications-1ov9hhr" label="日报邮件" description="独立于每日摘要、提醒渠道和免打扰。切换只保存设置，不补发历史日报。">
    <Switch label="日报邮件" checked={draft.reportEmailEnabled === true} disabled={!saved || loading || pending > 0} onCheckedChange={value => void owner.save(['reportEmailEnabled'], { reportEmailEnabled: value })} />
    {loading && <LoadingState label="读取邮件设置中…" />}{error && <InlineNotice tone="danger" title={error} />}{notice && <p role="status" className="oui-help">{notice}</p>}
    {!saved && error && <Button onClick={() => void owner.reload()}>重试邮件设置</Button>}
    <p className="oui-help">当前已保存邮箱：{saved?.reminderEmail || '注册邮箱'}。与每日摘要、周期提醒共用。<TextLink to="/settings/notifications?settings=setting-notifications-x4nqrq">编辑共享收件邮箱</TextLink></p>
  </SettingRow></SettingSection>;
}
