import { useEffect, useState } from 'react';
import { Button, TextLink } from '../../../ui';
import { androidCall, isAndroid, type AndroidStatus } from '../../../services/android-bridge';
import { SettingRow, SettingSection } from '../SettingFields';

export function AdvancedFeaturesSettings() {
  const [native, setNative] = useState<AndroidStatus | null>(null), [error, setError] = useState('');
  useEffect(() => { if (isAndroid()) void androidCall('status').then(setNative).catch(e => setError(e.message)); }, []);
  return <><SettingSection id="advanced-features" title="扩展功能" description="按需使用，保留原有记录与操作。">
    <SettingRow id="advanced-mail-import" label="邮箱导入" description="从邮箱收集事务，核对后确认导入。"><TextLink to="/import" state={{ importReturnTo: '/settings/advanced' }}>打开邮箱导入</TextLink></SettingRow>
    <SettingRow id="advanced-experience" label="记录经历" description="整理个人经历，预览并确认保存。"><TextLink to="/library/experience">打开记录经历</TextLink></SettingRow>
    <SettingRow id="advanced-research" label="研究与观点" description="查看和管理研究记录与已确认观点。"><TextLink to="/research">打开研究与观点</TextLink></SettingRow>
  </SettingSection>{isAndroid() && <SettingSection id="android-server" title="Android 客户端">
    <SettingRow id="android-server-settings" label="服务器设置" description="正式与测试环境分别保存登录和缓存；首次进入需要登录。手机推送仅在正式环境启用。">
      <p role="status">{native?.server ? `当前：${native.server.label}` : '请使用支持服务器切换的新版客户端。'}</p>
      <Button disabled={!native?.server} onClick={() => void androidCall('serverSettings').catch(e => setError(e.message))}>选择服务器</Button>
      {error && <p role="alert">{error}</p>}
    </SettingRow>
  </SettingSection>}</>;
}
