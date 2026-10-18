import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface ActionRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  description?: ReactNode;
  trailing?: ReactNode;
  compact?: boolean;
}
/** The entire row is one action; trailing content must not contain another control. */
export const ActionRow = forwardRef<HTMLButtonElement, ActionRowProps>(function ActionRow({ title, description, trailing, compact = false, className = '', ...props }, ref) {
  return <button {...props} ref={ref} title={title} type={props.type || 'button'} className={`oui-action-row${compact ? ' oui-action-row--compact' : ''} ${className}`}>
    <span className="oui-action-row-copy"><strong>{title}</strong>{description && <span>{description}</span>}</span>
    {trailing && <span className="oui-action-row-trailing">{trailing}</span>}
  </button>;
});
