import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';

export const isClockTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** Minute-precision clock UI only. Dates, timezones and persistence belong to callers. */
export function TimePicker({ value, onChange, label = '时间', disabled = false, required = true, onValidityChange }: {
  value: string; onChange: (value: string) => void; label?: string; disabled?: boolean; required?: boolean;
  onValidityChange?: (valid: boolean) => void;
}) {
  const timeName = label.endsWith('时间') ? label : `${label}时间`;
  const [open, setOpen] = useState(false), [selection, setSelection] = useState('00:00');
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null), hour = useRef<HTMLSelectElement>(null), minute = useRef<HTMLSelectElement>(null);
  const confirm = useRef<HTMLButtonElement>(null), id = useId();
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const valid = disabled || (!required && !text) || isClockTime(text);
  useEffect(() => { input.current?.setCustomValidity(valid ? '' : '请输入 00:00 至 23:59 的时间'); onValidityChange?.(valid); }, [valid, onValidityChange]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const element=panel.current,anchor=trigger.current?.getBoundingClientRect(),popup=element?.getBoundingClientRect();
      if(!element||!anchor||!popup)return;
      const left=Math.max(8,Math.min(anchor.left,innerWidth-popup.width-8));
      const top=anchor.bottom+popup.height+4<innerHeight?anchor.bottom+4:Math.max(8,anchor.top-popup.height-4);
      // A transformed Popover positioner establishes the fixed panel's containing block.
      const parent=element.offsetParent as HTMLElement|null,origin=parent?.getBoundingClientRect();
      const scale=origin&&parent?.offsetWidth?origin.width/parent.offsetWidth:1;
      setPosition(origin&&parent?{left:(left-origin.left)/scale+parent.scrollLeft-parent.clientLeft,top:(top-origin.top)/scale+parent.scrollTop-parent.clientTop}:{left,top});
    };
    place(); hour.current?.focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => {
      for (const list of [hour.current, minute.current]) {
        const option = list?.selectedOptions[0];
        if (list && option) list.scrollTop = option.offsetTop - list.offsetTop - list.clientHeight / 2 + option.offsetHeight / 2;
      }
    });
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);
  const dismiss = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  return <div ref={root} className="oui-time" onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
  }}>
    <div className="oui-time-input"><input ref={input} className="oui-input" type="text" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" inputMode="text" autoCapitalize="none" spellCheck={false} placeholder="HH:mm" aria-label={label} aria-describedby={!valid ? `${id}-error` : undefined} aria-invalid={!valid || undefined} required={required} disabled={disabled} value={text} onChange={event => { setText(event.target.value); onChange(event.target.value); }} />
      <button ref={trigger} type="button" className="oui-time-trigger" aria-label={`选择${label}`} aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => { if (open) dismiss(); else { setSelection(isClockTime(text) ? text : '00:00'); setOpen(true); } }}><Clock size={17} aria-hidden="true" /></button></div>
    {!valid && <small id={`${id}-error`} className="oui-field-error">请输入 00:00–23:59</small>}
    {open && <div id={id} ref={panel} role="group" aria-label={`${timeName}选择`} className="oui-time-panel" style={position}>
      <div className="oui-time-lists"><label>时<select ref={hour} size={5} value={selection.slice(0, 2)} aria-label={`${timeName}：小时`} onChange={event => setSelection(`${event.target.value}:${selection.slice(3)}`)} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); minute.current?.focus(); } }}>{Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(v => <option key={v}>{v}</option>)}</select></label>
      <label>分<select ref={minute} size={5} value={selection.slice(3)} aria-label={`${timeName}：分钟`} onChange={event => setSelection(`${selection.slice(0, 2)}:${event.target.value}`)} onKeyDown={event => { if ((event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); confirm.current?.focus(); } }}>{Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map(v => <option key={v}>{v}</option>)}</select></label></div>
      <div className="oui-time-actions"><button type="button" className="oui-button oui-button--secondary" onClick={dismiss}>取消</button><button ref={confirm} type="button" className="oui-button oui-button--primary" onClick={() => { setText(selection); onChange(selection); dismiss(); }}>确定</button></div>
    </div>}
  </div>;
}

export function DateTimePicker({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [date = '', time = ''] = value.split('T');
  return <div className="oui-datetime"><input className="oui-input" type="date" aria-label={`${label}日期`} value={date} onChange={event => onChange(`${event.target.value}T${time}`)} /><TimePicker label={`${label}时间`} value={time} onChange={v => onChange(`${date}T${v}`)} /></div>;
}
