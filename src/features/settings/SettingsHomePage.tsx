import { useSyncExternalStore } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { SettingsFrame } from '../../layouts/SettingsFrame';
import { settingsCategories } from './navigation';

const desktopQuery = '(min-width: 768px)';
function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia(desktopQuery); media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export default function SettingsHomePage() {
  const location = useLocation();
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(desktopQuery).matches);
  if (desktop) return <Navigate to="/settings/account" state={location.state} replace />;
  return <SettingsFrame navigation={settingsCategories} title="设置" description="按需要调整你的 Orbit。"><nav className="settings-category-list" aria-label="设置入口">
    {settingsCategories.map(item => <Link to={item.to} state={location.state} key={item.id}><div><strong>{item.title}</strong><p>{item.description}</p></div><ChevronRight size={18} aria-hidden="true" /></Link>)}
  </nav></SettingsFrame>;
}
