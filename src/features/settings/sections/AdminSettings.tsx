import { Button } from '../../../ui';
import { SettingRow,SettingSection } from "../SettingFields";
import { useSettingsRequest } from '../SettingsState';
export function AdminSettings({ onOpenAdmin }: {
    onOpenAdmin?: () => void;
}) {
    const settingsFetch = useSettingsRequest();
    return (<SettingSection id="admin" title="管理员功能">
      <SettingRow label="管理面板" description="管理用户、查看调试日志与全站备份。">
        <div className="settings-actions"><Button variant="secondary" onClick={onOpenAdmin}>打开管理面板</Button></div>
      </SettingRow>
    </SettingSection>);
}
