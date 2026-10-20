import { Button, useActionConfirmation } from '../../ui';
import { CheckCircle2, Circle, Edit3, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Schedule } from './schedule-types';

interface ScheduleContextMenuProps {
  schedule: Schedule;
  x: number;
  y: number;
  onClose: () => void;
  onEdit: (schedule: Schedule) => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void | boolean | Promise<void | boolean>;
}

export function ScheduleContextMenu({ schedule, x, y, onClose, onEdit, onToggle, onDelete }: ScheduleContextMenuProps) {
  const confirmation = useActionConfirmation();
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    if (!previousFocus.current) previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const anchor = previousFocus.current?.closest<HTMLElement>('[data-schedule-id]');
    const anchorPosition = anchor?.getBoundingClientRect();
    if (!confirmation.open) ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus({ preventScroll: true });
    const close = () => { if (!confirmation.open) onClose(); };
    const followAnchor = () => {
      const current = anchor?.getBoundingClientRect(), menu = ref.current?.getBoundingClientRect();
      if (!anchor?.isConnected || !anchorPosition || !current || !menu || current.bottom < 0 || current.top > innerHeight) { onClose(); return; }
      // Layout/focus scroll can finish after opening. Follow that movement;
      // intentional wheel/touch scrolling still dismisses the menu below.
      setPosition({left: Math.max(8, Math.min(x + current.left - anchorPosition.left, innerWidth - menu.width - 8)), top: Math.max(8, Math.min(y + current.top - anchorPosition.top, innerHeight - menu.height - 8))});
    };
    const handleKey = (event: KeyboardEvent) => {
      if (confirmation.open) return;
      if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();onClose();previousFocus.current?.focus({preventScroll:true}); }
      if (event.key === 'Tab') { onClose();previousFocus.current?.focus({preventScroll:true}); }
      if (!['ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
      const items=Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)') || []);
      if (!items.length) return;event.preventDefault();
      const current=items.indexOf(document.activeElement as HTMLButtonElement), index=event.key==='Home'?0:event.key==='End'?items.length-1:(current+(event.key==='ArrowUp'?-1:1)+items.length)%items.length;items[index]?.focus({ preventScroll: true });
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', followAnchor, true);
    window.addEventListener('wheel', close, { passive: true });
    window.addEventListener('touchmove', close, { passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', followAnchor, true);
      window.removeEventListener('wheel', close);
      window.removeEventListener('touchmove', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose, x, y, confirmation.open]);

  return (
    <>{confirmation.dialog}<div
      ref={ref}
      className="schedule-context-menu"
      style={position}
      role="menu"
      aria-label={`${schedule.title} 的日程操作`}
      onPointerDown={event => event.stopPropagation()}
    >
      <div className="schedule-context-title" title={schedule.title}>{schedule.title}</div>
      <button type="button" role="menuitem" onClick={() => { onEdit(schedule); onClose(); }}>
        <Edit3 size={15} />编辑日程
      </button>
      <button type="button" role="menuitem" onClick={() => { onToggle(schedule.id); onClose(); }}>
        {schedule.is_completed ? <Circle size={15} /> : <CheckCircle2 size={15} />}
        {schedule.is_completed ? '标记为未完成' : '标记为已完成'}
      </button>
      <div className="schedule-context-separator" />
      <Button
        type="button"
        role="menuitem"
        className="danger"
        onClick={() => {
          void confirmation.run({title:'删除日程？',description:`确定删除“${schedule.title}”吗？删除后无法撤销。`,confirmLabel:'删除日程',kind:'popover',anchor:previousFocus.current?.closest<HTMLElement>('[data-schedule-id]') || previousFocus.current}, () => onDelete(schedule.id)).then(() => { onClose(); previousFocus.current?.focus({preventScroll:true}); });
        }}
      >
        <Trash2 size={15} />删除日程
      </Button>
    </div></>
  );
}
