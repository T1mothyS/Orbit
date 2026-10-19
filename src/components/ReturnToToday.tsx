import { ArrowLeft } from 'lucide-react';
import { IconLink } from '../ui';

export function ReturnToToday() {
  return <div className="orbit-page-return"><IconLink to="/today" state={{settingsFocusReturn:true}} label="返回今日行动中心"><ArrowLeft size={18} aria-hidden="true" /></IconLink></div>;
}
