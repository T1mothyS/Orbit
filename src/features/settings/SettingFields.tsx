import { createContext,useContext,type ComponentProps } from 'react';
import { SettingRow as Row,Section } from '../../ui';
import { settingDefinition } from '../../utils/settings-registry';
import { settingId } from '../../utils/settings-search';

const SectionId = createContext('');
/** Semantic setting IDs are a feature concern; visuals belong exclusively to src/ui. */
export function SettingSection({ id, ...props }: ComponentProps<typeof Section> & { id: string }) {
  return <SectionId.Provider value={id}><Section {...props} id={`settings-${id}`} /></SectionId.Provider>;
}
export function SettingRow({ id, keywords: _keywords, searchDescription: _search, ...props }: ComponentProps<typeof Row> & { keywords?: string[]; searchDescription?: string }) {
  const section = useContext(SectionId);
  return <Row {...props} id={id || settingDefinition(section, props.label)?.id || settingId(section, props.label)} />;
}
