import { ArrowUpRight } from 'lucide-react';
import { IconButton } from '../../../ui';
import { SettingRow,SettingSection } from "../SettingFields";
export function ToolsSettings({ onOpenTools }: {
    onOpenTools?: () => void;
}) {
    return (<SettingSection id="tools" title="挂载工具" description="这里集中放置个人挂载的网页应用，不属于 Orbit 主功能。">
      <SettingRow label="Tools 工具中心" description="进入挂载应用菜单，选择要打开的网页工具。" headingAction={<IconButton label="打开 Tools" variant="quiet" onClick={onOpenTools} disabled={!onOpenTools}><ArrowUpRight size={18} aria-hidden="true" /></IconButton>} />
    </SettingSection>);
}
