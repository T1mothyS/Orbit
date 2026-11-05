import { TextLink } from '../../../ui';
import { SettingRow, SettingSection } from '../SettingFields';

export function AdvancedFeaturesSettings() {
  return <SettingSection id="advanced-features" title="扩展功能" description="按需使用，保留原有记录与操作。">
    <SettingRow id="advanced-mail-import" label="邮箱导入" description="从邮箱收集事务，核对后确认导入。"><TextLink to="/import" state={{ importReturnTo: '/settings/advanced' }}>打开邮箱导入</TextLink></SettingRow>
    <SettingRow id="advanced-experience" label="记录经历" description="整理个人经历，预览并确认保存。"><TextLink to="/library/experience">打开记录经历</TextLink></SettingRow>
    <SettingRow id="advanced-research" label="研究与观点" description="查看和管理研究记录与已确认观点。"><TextLink to="/research">打开研究与观点</TextLink></SettingRow>
  </SettingSection>;
}
