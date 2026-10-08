import { useEffect,useRef,useState, type ReactNode } from 'react';
import {SettingsSearchProvider} from './SettingsSearch';

export function SettingsLayout({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const [active,setActive]=useState('account');
  useEffect(()=>{const set=(e:Event)=>{const id=(e as CustomEvent<string>).detail;setActive(id);if((e as CustomEvent).type==='orbit:settings-open-section')contentRef.current?.querySelector<HTMLElement>(`#settings-${id}`)?.scrollIntoView({block:'start'});};document.addEventListener('orbit:settings-section',set);document.addEventListener('orbit:settings-open-section',set);return()=>{document.removeEventListener('orbit:settings-section',set);document.removeEventListener('orbit:settings-open-section',set);};},[]);
  const sections = [
    ['account', '账户'], ['ai', 'AI'], ['guides', '接入指南'], ['notifications', '通知'],
    ['caldav', '荣耀日历'], ['daily-report', '日报'], ['report-email', '日报邮件'], ['library', '知识库'], ['tools', '挂载工具'], ['mail', '邮箱'], ['data', '数据'],
    ...(isAdmin ? [['admin', '管理']] : []),
  ];

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const items = [...root.querySelectorAll<HTMLElement>('.setting-section[id]')];
      if (!items.length || !root.clientHeight) return;
      const line = root.getBoundingClientRect().top + (parseFloat(getComputedStyle(root).scrollPaddingTop) || 0) + 1;
      let current = items[0];
      for (const item of items) if (item.getBoundingClientRect().top <= line) current = item;
      if (root.scrollHeight > root.clientHeight + 1 && root.scrollTop + root.clientHeight >= root.scrollHeight - 1) current = items[items.length - 1];
      setActive(current.id.replace(/^settings-/, ''));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    root.querySelectorAll<HTMLElement>('.setting-section').forEach(item => resize.observe(item));
    root.addEventListener('scroll', schedule, {passive:true});
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      root.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [isAdmin]);

  useEffect(() => {
    const nav = navRef.current;
    const item = nav?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!nav || !item || !nav.clientHeight) return;
    const bounds = nav.getBoundingClientRect(), target = item.getBoundingClientRect();
    if (target.top < bounds.top) nav.scrollTop += target.top - bounds.top;
    else if (target.bottom > bounds.bottom) nav.scrollTop += target.bottom - bounds.bottom;
  }, [active]);

  return (
    <div className="settings-layout"><SettingsSearchProvider>
      <nav className="settings-nav" aria-label="设置分类" ref={navRef}>
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
