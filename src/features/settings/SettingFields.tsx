import { createContext,useContext,useLayoutEffect,type ComponentProps } from 'react';
import { useLocation } from 'react-router-dom';
import { SettingRow as Row,Section } from '../../ui';
import { settingDefinition } from '../../utils/settings-registry';
import { settingId } from '../../utils/settings-search';
import { SettingsHeadingHelp } from '../../layouts/SettingsFrame';

const SectionId = createContext('');
/** Semantic setting IDs are a feature concern; visuals belong exclusively to src/ui. */
export function SettingSection({ id, description, help, ...props }: ComponentProps<typeof Section> & { id: string }) {
  const category = useLocation().pathname.split('/')[2];
  const setHeadingHelp = useContext(SettingsHeadingHelp), hideTitle = id === category;
  useLayoutEffect(() => {
    if (!hideTitle) return;
    setHeadingHelp(<>{description && <p>{description}</p>}{help && <div>{help}</div>}</>);
    return () => setHeadingHelp(undefined);
  }, [hideTitle, description, help, setHeadingHelp]);
  return <SectionId.Provider value={id}><Section hideTitle={hideTitle} {...props} help={!hideTitle && (description || help) ? <>{description && <p>{description}</p>}{help && <div>{help}</div>}</> : undefined} id={`settings-${id}`} /></SectionId.Provider>;
}
export function SettingRow({ id, description, help, keywords: _keywords, searchDescription: _search, ...props }: ComponentProps<typeof Row> & { keywords?: string[]; searchDescription?: string }) {
  const section = useContext(SectionId);
  return <Row {...props} help={description || help ? <>{description && <p>{description}</p>}{help && <div>{help}</div>}</> : undefined} id={id || settingDefinition(section, props.label)?.id || settingId(section, props.label)} />;
}
