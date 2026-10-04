import {useContext,useEffect,useRef,type ReactNode} from 'react';
import {SettingSectionContext,useSettingIndex} from './SettingsSearch';
import {settingId,settingKeywords} from '../../utils/settings-search';
import { settingDefinition } from '../../utils/settings-registry';
import { Input, type InputProps } from 'tdesign-react';

// 当前 TDesign Input 不透传原生 id，使用其公开 inputElement 关联表单标签。
export function SettingInput({ id, ...props }: InputProps & { id: string }) {
  return <Input {...props} ref={instance => { if (instance?.inputElement) instance.inputElement.id = id; }} />;
}

interface SettingRowProps {
  label: string;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  id?:string;
  keywords?:string[];
  searchDescription?:string;
}

export function SettingRow({ label, description, htmlFor, children,id,keywords,searchDescription }: SettingRowProps) {
  const section=useContext(SettingSectionContext),{register}=useSettingIndex(),ref=useRef<HTMLDivElement>(null);
  const definition=settingDefinition(section,label);
  const itemId=id||definition?.id||settingId(section,label),descriptionText=searchDescription||definition?.description||(typeof description==='string'?description:'');
  const keywordText=JSON.stringify(keywords||settingKeywords(label));
  useEffect(()=>{if(ref.current)return register({id:itemId,section,label,description:descriptionText,keywords:JSON.parse(keywordText)},ref.current);},[register,itemId,section,label,descriptionText,keywordText]);
  return (
    <div ref={ref} id={itemId} className="setting-row" tabIndex={-1}>
      <div className="setting-row-label">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <h3>{label}</h3>}
        {description && <p>{description}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
