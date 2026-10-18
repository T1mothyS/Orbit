import { ChevronRight } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Link,Navigate,useLocation } from 'react-router-dom';
import { settingsCategories } from './navigation';

const desktopQuery = '(min-width: 768px)';
function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia(desktopQuery); media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export default function SettingsHomePage() {
  const location = useLocation();
  const desktop = useSyncExternalStore(subscribeDesktop, () => window.matchMedia(desktopQuery).matches);
  if (desktop) return <Navigate to={'/settings/account' + location.search} state={location.state} replace />;
  return <nav className="settings-category-list" aria-label="设置入口">
    {settingsCategories.map(item => <Link to={item.to} state={location.state} key={item.id}><div><strong>{item.title}</strong><p>{item.description}</p></div><ChevronRight size={18} aria-hidden="true" /></Link>)}
  </nav>;
}
