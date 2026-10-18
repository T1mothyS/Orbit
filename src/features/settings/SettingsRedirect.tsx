import { Navigate,useLocation } from 'react-router-dom';
import { moduleSettingsPath } from '../../utils/module-settings';
export default function SettingsRedirect({ target = '/settings' }: { target?: string }) {
  const location = useLocation(), params = new URLSearchParams(location.search), id = params.get('settings');
  const path = moduleSettingsPath(id) || target;
  params.delete('settings');
  const aliasHome = location.pathname === '/library/settings' ? '/library' : location.pathname === '/reports/settings' || location.pathname === '/library/preferences' ? '/reports' : null;
  const supplied = (location.state as { settingsReturnTo?: string } | null)?.settingsReturnTo;
  const origin = supplied || aliasHome || (location.pathname.startsWith('/settings') ? '/assistant' : location.pathname + (params.size ? '?' + params : ''));
  return <Navigate to={path + location.search} replace state={{ ...(location.state as object), settingsReturnTo: origin }} />;
}
