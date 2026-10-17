import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'link' | 'danger';
  size?: 'default' | 'small';
  loading?: boolean;
  leadingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'secondary', size = 'default', loading = false, leadingIcon, disabled,
  type = 'button', className = '', children, ...props
}, ref) {
  return <button {...props} ref={ref} type={type} disabled={disabled || loading}
    aria-busy={loading || undefined} className={`oui-button oui-button--${variant} oui-button--${size} ${className}`}>
    {loading ? <LoaderCircle className="oui-spinner" size={16} aria-hidden="true" /> : leadingIcon}
    <span>{children}</span>
  </button>;
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'leadingIcon'> {
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, children, className = '', ...props }, ref) {
  return <Button {...props} ref={ref} aria-label={label} className={`oui-icon-button ${className}`} leadingIcon={children} />;
});
