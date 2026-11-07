import { Clock, Sun } from 'lucide-react';
import { Input } from '../../ui';
import { useId, useRef, type CSSProperties, type PointerEvent } from 'react';

type Choice = { value: string; label?: string; tone: string };

const timeModes = [
  { value: 'timed', label: '指定时间', Icon: Clock },
  { value: 'allDay', label: '全天', Icon: Sun },
] as const;

export function ScheduleStepSlider({ label, value, options, onChange }: {
  label: string; value: string; options: Choice[]; onChange: (value: string) => void;
}) {
  const name = useId();
  const pointer = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const skipClick = useRef(false);
  const selected = options.findIndex(option => option.value === value);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(':disabled')) return;
    skipClick.current = false;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
    (event.target as Element).setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const gesture = pointer.current;
    if (gesture?.id !== event.pointerId) return;
    const dx = Math.abs(event.clientX - gesture.x);
    const dy = Math.abs(event.clientY - gesture.y);
    if (!gesture.dragging && (dx < 5 || dx < dy)) return;
    gesture.dragging = true;
    skipClick.current = true;
    const { left, width } = event.currentTarget.getBoundingClientRect();
    const index = Math.max(0, Math.min(options.length - 1, Math.floor((event.clientX - left) / width * options.length)));
    if (index !== selected) onChange(options[index].value);
  }

  return <fieldset className="choice-field">
    <legend>{label}</legend>
    <div className="step-slider" style={{ '--step-count': options.length, '--selected-step': Math.max(0, selected) } as CSSProperties}
      onPointerDown={startDrag} onPointerMove={moveDrag}
      onPointerUp={event => {
        if (pointer.current?.dragging) event.currentTarget.querySelector<HTMLInputElement>('input:checked')?.focus({ preventScroll: true });
        pointer.current = null;
      }}
      onPointerCancel={() => { pointer.current = null; skipClick.current = false; }}
      onClickCapture={event => {
        if (!skipClick.current || event.detail === 0) return;
        skipClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}>
      <div className="step-track" aria-hidden="true" />
      {selected >= 0 && <div className="step-thumb" data-tone={options[selected].tone} aria-hidden="true"><i /></div>}
      {options.map(option => <label key={option.value} className="step-option" data-tone={option.tone}>
        <Input className="choice-input" type="radio" name={name} value={option.value}
          checked={value === option.value} onChange={() => onChange(option.value)} aria-label={option.label || option.value} />
        <i className="step-dot" aria-hidden="true" />
        <span>{option.label || option.value}</span>
      </label>)}
    </div>
  </fieldset>;
}

export type ScheduleTimeMode = 'timed' | 'allDay' | 'unscheduled';

export function ScheduleTimeModeSwitch({ value, canBeUnscheduled, onChange }: {
  value: ScheduleTimeMode; canBeUnscheduled: boolean; onChange: (value: ScheduleTimeMode) => void;
}) {
  const name = useId();
  const selected = timeModes.findIndex(mode => mode.value === value);
  return <fieldset className="choice-field">
    <legend>时间类型</legend>
    <div className="mode-row">
      <div className="mode-track" data-selected={selected}>
        <span className="mode-thumb" aria-hidden="true" />
        {timeModes.map(({ value: mode, label, Icon }) => <label key={mode} className="mode-option">
          <Input className="choice-input" type="radio" name={name} checked={value === mode} onChange={() => onChange(mode)} />
          <Icon size={15} aria-hidden="true" />{label}
        </label>)}
      </div>
      {canBeUnscheduled && <label className="unscheduled-option">
        <Input className="choice-input" type="radio" name={name} checked={value === 'unscheduled'} onChange={() => onChange('unscheduled')} />
        无固定期限
      </label>}
    </div>
  </fieldset>;
}
