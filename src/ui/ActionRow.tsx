import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface ActionRowProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  description?: ReactNode;
  trailing?: ReactNode;
}
/** The entire row is one action; trailing content must not contain another control. */
export const ActionRow = forwardRef<HTMLButtonElement, ActionRowProps>(function ActionRow({ title, description, trailing, className = '', ...props }, ref) {
  return <button {...props} ref={ref} type={props.type || 'button'} className={`oui-action-row ${className}`}>
    <span className="oui-action-row-copy"><strong>{title}</strong>{description && <span>{description}</span>}</span>
    {trailing && <span className="oui-action-row-trailing">{trailing}</span>}
  </button>;
});
