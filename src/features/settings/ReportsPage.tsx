import { useEffect,useState } from 'react';
import { useLocation,useNavigate } from 'react-router-dom';
import { Section,Tabs } from '../../ui';
import { SettingsActivity,useSettingsActive,useSettingsState } from './SettingsState';
import { ContextEditor } from './context/ContextEditor';
import { DailyReportSettings } from './sections/DailyReportSettings';
import { MailSettings } from './sections/MailSettings';
import { ReportEmailSettings } from './sections/ReportEmailSettings';
export function ReportsPage() {
  const location = useLocation(), navigate = useNavigate(), active = useSettingsActive(), { authHeaders } = useSettingsState();
  const tab = location.pathname.endsWith('/delivery') ? 'functional' : 'personal';
  const [visitedFunctional, setVisitedFunctional] = useState(false);
  useEffect(() => { if (tab === 'functional') setVisitedFunctional(true); }, [tab]);
  return <Tabs label="日报设置分类" value={tab} onValueChange={value => navigate(value === 'functional' ? '/settings/reports/delivery' : '/settings/reports', {state:location.state})} keepMounted items={[
    { value: 'personal', label: '个性化', content: <SettingsActivity active={active && tab === 'personal'}><Section id="settings-report-personalization" title="日报个性化" help="阅读偏好、近期关注、Watchlist 与 Cloud 研究框架。"><ContextEditor /></Section></SettingsActivity> },
    { value: 'functional', label: '接收与邮件', content: (visitedFunctional || tab === 'functional') ? <SettingsActivity active={active && tab === 'functional'}><ReportEmailSettings /><DailyReportSettings authHeaders={authHeaders} /><MailSettings authHeaders={authHeaders} /></SettingsActivity> : null },
  ]} />;
}
