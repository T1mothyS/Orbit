import { Link as RouterLink, type LinkProps } from 'react-router-dom';
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';
import type { ButtonProps } from './Button';

export function ButtonLink({ variant = 'secondary', className = '', ...props }: LinkProps & { variant?: ButtonProps['variant'] }) {
  return <RouterLink {...props} className={`oui-button oui-button--${variant} oui-button--default ${className}`} />;
}

export function TextLink({ to, state, children }: { to: string; state?: unknown; children: ReactNode }) {
  return <RouterLink to={to} state={state} className="oui-text-link">{children}</RouterLink>;
}
export const IconLink = forwardRef<HTMLAnchorElement, LinkProps & { label: string; children: ReactNode }>(function IconLink({ label, children, className = '', ...props }, ref) {
  return <RouterLink {...props} ref={ref} aria-label={label} title={props.title || label} className={`oui-button oui-button--quiet oui-button--default oui-icon-button oui-icon-link ${className}`}>{children}</RouterLink>;
});
export function ExternalLink({ className = '', ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} className={`oui-text-link ${className}`} />;
}
export function NavigationItem({ label, icon, current, onSelect }: { label: string; icon: ReactNode; current: boolean; onSelect: () => void }) {
  return <button type="button" className="oui-nav-item" aria-label={label} title={label} aria-current={current ? 'page' : undefined} onClick={onSelect}>{icon}<span>{label}</span></button>;
}
