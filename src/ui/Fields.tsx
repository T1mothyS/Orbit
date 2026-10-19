import { forwardRef, useState, type InputHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';
import { Check, ChevronDown, Eye, EyeOff } from 'lucide-react';
import { Checkbox as PrimitiveCheckbox } from '@base-ui/react/checkbox';
import { Switch as PrimitiveSwitch } from '@base-ui/react/switch';
import { Select as PrimitiveSelect } from '@base-ui/react/select';
import { IconButton } from './Button';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { focusIndicator?: 'ring' | 'border' }>(function Input({ className = '', focusIndicator = 'ring', ...props }, ref) {
  return <input {...props} ref={ref} className={`oui-input${focusIndicator === 'border' ? ' oui-input--border-focus' : ''} ${className}`} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { compact?: boolean; autoGrow?: boolean }>(function Textarea({ className = '', compact = false, autoGrow = false, ...props }, ref) {
  return <textarea {...props} ref={ref} className={`oui-input oui-textarea${compact ? ' oui-textarea--compact' : ''}${autoGrow ? ' oui-textarea--grow' : ''} ${className}`} />;
});
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(function PasswordInput({ className = '', disabled, ...props }, ref) {
  const [visible, setVisible] = useState(false);
  const label = props['aria-label'] || '密码';
  return <div className={`oui-password ${className}`}>
    <Input {...props} disabled={disabled} ref={ref} type={visible ? 'text' : 'password'} />
    <IconButton variant="quiet" label={`${visible ? '隐藏' : '显示'}${label}`} disabled={disabled} aria-pressed={visible}
      onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</IconButton>
  </div>;
});

interface ToggleProps {
  id?: string;
  name?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  describedBy?: string;
}
export function Checkbox({ label, describedBy, ...props }: ToggleProps) {
  return <PrimitiveCheckbox.Root {...props} aria-label={label} aria-describedby={describedBy} className="oui-checkbox">
    <PrimitiveCheckbox.Indicator className="oui-checkbox-indicator"><Check size={15} strokeWidth={2.5} /></PrimitiveCheckbox.Indicator>
  </PrimitiveCheckbox.Root>;
}
export function Switch({ label, describedBy, ...props }: ToggleProps) {
  return <PrimitiveSwitch.Root {...props} aria-label={label} aria-describedby={describedBy} className="oui-switch">
    <PrimitiveSwitch.Thumb className="oui-switch-thumb" />
  </PrimitiveSwitch.Root>;
}

export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps {
  id?: string;
  name?: string;
  label: string;
  value: string | null;
  onValueChange: (value: string | null) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  portalContainer?: HTMLElement | null;
}
export function Select({ id, label, options, placeholder = '请选择', invalid, describedBy, portalContainer, ...props }: SelectProps) {
  return <PrimitiveSelect.Root {...props} items={options}>
    <PrimitiveSelect.Trigger id={id} className="oui-input oui-select" aria-label={label} aria-invalid={invalid || undefined} aria-describedby={describedBy}>
      <PrimitiveSelect.Value placeholder={placeholder} /><PrimitiveSelect.Icon><ChevronDown size={16} /></PrimitiveSelect.Icon>
    </PrimitiveSelect.Trigger>
    <PrimitiveSelect.Portal container={portalContainer}><PrimitiveSelect.Positioner sideOffset={6} className="oui-positioner" alignItemWithTrigger={false}>
      <PrimitiveSelect.Popup className="oui-menu"><PrimitiveSelect.List>
        {options.map(option => <PrimitiveSelect.Item key={option.value} value={option.value} disabled={option.disabled} className="oui-option">
          <PrimitiveSelect.ItemText>{option.label}</PrimitiveSelect.ItemText>
          <PrimitiveSelect.ItemIndicator><Check size={16} /></PrimitiveSelect.ItemIndicator>
        </PrimitiveSelect.Item>)}
      </PrimitiveSelect.List></PrimitiveSelect.Popup>
    </PrimitiveSelect.Positioner></PrimitiveSelect.Portal>
  </PrimitiveSelect.Root>;
}

export function FormField({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return <div className="oui-field"><label htmlFor={id} className="oui-label">{label}</label>
    {children}
    {error ? <p className="oui-field-error" id={`${id}-description`} role="alert">{error}</p>
      : hint ? <p className="oui-help" id={`${id}-description`}>{hint}</p> : null}
  </div>;
}
