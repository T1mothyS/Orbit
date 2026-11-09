import { ArrowUpRight } from 'lucide-react';
import { IconButton } from '../../../ui';
import { SettingRow,SettingSection } from "../SettingFields";
export function AdminSettings({ onOpenAdmin }: {
    onOpenAdmin?: () => void;
}) {
    return (<SettingSection id="admin" title="管理员功能">
      <SettingRow label="管理面板" description="管理用户、查看调试日志与全站备份。" headingAction={<IconButton label="打开管理面板" variant="quiet" onClick={onOpenAdmin} disabled={!onOpenAdmin}><ArrowUpRight size={18} aria-hidden="true" /></IconButton>} />
    </SettingSection>);
}
