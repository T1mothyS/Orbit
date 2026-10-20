import { useEffect, useRef, useState } from 'react';
import type { EvolutionData } from '../types/project-evolution';
import { Button, Tooltip } from '../ui';

export function EvolutionTimeline({ data, selectedId, important, onSelect, onPause }: { data: EvolutionData; selectedId: string; important: Set<string>; onSelect: (id: string) => void; onPause: () => void }) {
  const track = useRef<HTMLDivElement>(null);
  const [focusedId, setFocusedId] = useState(selectedId);
  const reveal = (element: HTMLElement) => {
    const container = track.current;
    if (!container) return;
    const left = element.getBoundingClientRect().left - container.getBoundingClientRect().left + container.scrollLeft;
    if (left < container.scrollLeft || left + element.offsetWidth > container.scrollLeft + container.clientWidth) container.scrollLeft = left - (container.clientWidth - element.offsetWidth) / 2;
  };
  useEffect(() => {
    setFocusedId(selectedId);
    const selected = track.current?.querySelector<HTMLElement>('[aria-current="step"]');
    if (selected) reveal(selected);
  }, [selectedId]);
  return <nav className="evolution-timeline" aria-label="成长时间线" data-selected-id={selectedId}>
    <div className="evolution-timeline-heading"><strong>里程碑</strong><span>{data.milestones.findIndex(item => item.id === selectedId) + 1} / {data.milestones.length} · 按先后等距，间距不代表天数</span></div>
    <div className="evolution-timeline-track" ref={track}><ol>{data.milestones.map((item, index) => {
      const fact = data.facts.find(f => f.id === item.id)!;
      const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(fact.date));
      return <li key={item.id} data-important={important.has(item.id) || undefined}><Tooltip content={`${item.title} · ${date} · ${fact.version ? `V${fact.version}` : '版本未记录'}`}><Button variant="quiet" data-milestone={item.id} aria-label={`里程碑：${item.title}`} aria-current={selectedId === item.id ? 'step' : undefined} tabIndex={focusedId === item.id ? 0 : -1} onFocus={() => { setFocusedId(item.id); onPause(); }} onClick={() => onSelect(item.id)} onKeyDown={event => {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? data.milestones.length - 1 : event.key === 'ArrowLeft' ? Math.max(0, index - 1) : event.key === 'ArrowRight' ? Math.min(data.milestones.length - 1, index + 1) : null;
        if (next === null) return;
        event.preventDefault(); onPause();
        const target = track.current?.querySelectorAll<HTMLButtonElement>('button')[next];
        target?.focus({ preventScroll: true }); if (target) reveal(target);
      }}><span className="evolution-timeline-dot" aria-hidden="true" /><span className="evolution-timeline-date" aria-hidden="true">{important.has(item.id) || selectedId === item.id || index === 0 ? date.slice(5) : index + 1}</span></Button></Tooltip></li>;
    })}</ol></div>
  </nav>;
}
