import {useEffect,useRef,type ReactNode} from 'react';
import {SettingSectionContext,useSettingIndex} from './SettingsSearch';
import {settingKeywords} from '../../utils/settings-search';

interface SettingSectionProps {
  id: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

export function SettingSection({ id, title, description, children }: SettingSectionProps) {
  const ref=useRef<HTMLElement>(null),{register}=useSettingIndex();
  useEffect(()=>{if(ref.current)return register({id:`settings-${id}`,section:id,label:title,description:typeof description==='string'?description:'',keywords:settingKeywords(title)},ref.current);},[register,id,title,description]);
  return (
    <SettingSectionContext.Provider value={id}><section ref={ref} id={`settings-${id}`} className="setting-section" aria-labelledby={`settings-${id}-title`} tabIndex={-1}>
      <header className="setting-section-header">
        <h2 id={`settings-${id}-title`}>{title}</h2>
        {description && <p>{description}</p>}
      </header>
      <div className="setting-section-body">{children}</div>
    </section></SettingSectionContext.Provider>
  );
}
