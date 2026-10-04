import { useEffect,useRef,useState, type ReactNode } from 'react';
import {SettingsSearchProvider} from './SettingsSearch';

export function SettingsLayout({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [active,setActive]=useState('account');
  useEffect(()=>{const set=(e:Event)=>{const id=(e as CustomEvent<string>).detail;setActive(id);if((e as CustomEvent).type==='orbit:settings-open-section')contentRef.current?.querySelector<HTMLElement>(`#settings-${id}`)?.scrollIntoView({block:'start'});};document.addEventListener('orbit:settings-section',set);document.addEventListener('orbit:settings-open-section',set);return()=>{document.removeEventListener('orbit:settings-section',set);document.removeEventListener('orbit:settings-open-section',set);};},[]);
  const sections = [
    ['account', '账户'], ['ai', 'AI'], ['guides', '接入指南'], ['notifications', '通知'],
    ['caldav', '荣耀日历'], ['daily-report', '日报'], ['library', '知识库'], ['tools', '挂载工具'], ['mail', '邮箱'], ['data', '数据'],
    ...(isAdmin ? [['admin', '管理']] : []),
  ];

  return (
    <div className="settings-layout"><SettingsSearchProvider>
      <nav className="settings-nav" aria-label="设置分类">
        {sections.map(([id, label]) => (
          <button key={id} type="button" aria-current={active===id?'true':undefined} onClick={() => {
            setActive(id);
            const section = contentRef.current?.querySelector<HTMLElement>(`#settings-${id}`);
            section?.scrollIntoView({ block: 'start' });
            section?.focus({ preventScroll: true });
          }}>{label}</button>
        ))}
      </nav>
      <div className="settings-scroll" ref={contentRef}>{children}</div>
    </SettingsSearchProvider></div>
  );
}
