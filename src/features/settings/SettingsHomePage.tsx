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
    {settingsCategories.map(item => <div className="settings-category-entry" key={item.id}><Link to={item.to} state={location.state} aria-label={item.title} aria-describedby={`settings-category-description-${item.id}`}><span className="settings-category-icon"><item.icon size={21} aria-hidden="true" /></span><span className="settings-category-copy"><strong>{item.title}</strong><span id={`settings-category-description-${item.id}`}>{item.description}</span></span><ChevronRight size={18} aria-hidden="true" /></Link></div>)}
  </nav>;
}
