import { useRef } from 'react';
interface Option<T extends string> { value: T; label: string }
export function OrbitSegmentedControl<T extends string>({ label, value, options, disabled, onChange }: {
  label: string; value: T; options: [Option<T>, Option<T>]; disabled?: boolean; onChange: (value: T) => void;
}) {
  const gesture = useRef<{ id: number; x: number; y: number; axis?: 'x' | 'y' } | null>(null);
  const suppressClick = useRef(false);
  return <div className="orbit-segmented" role="group" aria-label={label} aria-disabled={disabled || undefined} data-index={options.findIndex(option => option.value === value)}
    onPointerDown={event => { if (!disabled && event.isPrimary && event.button === 0) { suppressClick.current = false; gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; } }}
    onPointerMove={event => {
      const start = gesture.current; if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (!start.axis && Math.hypot(dx, dy) >= 8) start.axis = Math.abs(dx) > Math.abs(dy) * 1.4 ? 'x' : 'y';
      if (start.axis === 'x') { event.currentTarget.setPointerCapture(event.pointerId); suppressClick.current = true; }
    }}
    onPointerUp={event => {
      const start = gesture.current; gesture.current = null;
      if (!start || start.id !== event.pointerId || disabled) return;
      if (start.axis === 'x' && Math.abs(event.clientX - start.x) >= 24) onChange(options[event.clientX > start.x ? 1 : 0].value);
    }}
    onPointerCancel={() => { gesture.current = null; suppressClick.current = true; }}
    onLostPointerCapture={() => { gesture.current = null; }}>
    <span className="orbit-segmented-indicator" aria-hidden="true" />
    {options.map(option => <button key={option.value} type="button" disabled={disabled} aria-pressed={value === option.value}
      onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onChange(option.value); }}
      onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' || event.key === 'ArrowLeft' ? 0 : 1; onChange(options[next].value); (event.currentTarget.parentElement?.querySelectorAll('button')[next] as HTMLButtonElement)?.focus(); } }}>
      {option.label}</button>)}
  </div>;
}
