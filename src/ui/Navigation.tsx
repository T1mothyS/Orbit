import { Link as RouterLink } from 'react-router-dom';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

export function TextLink({ to, state, children }: { to: string; state?: unknown; children: ReactNode }) {
  return <RouterLink to={to} state={state} className="oui-text-link">{children}</RouterLink>;
}
export function IconLink({ to, state, label, children }: { to: string; state?: unknown; label: string; children: ReactNode }) {
  return <RouterLink to={to} state={state} aria-label={label} title={label} className="oui-button oui-button--quiet oui-button--default oui-icon-button oui-icon-link">{children}</RouterLink>;
}
export function ExternalLink({ className = '', ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} className={`oui-text-link ${className}`} />;
}
export function NavigationItem({ label, icon, current, onSelect }: { label: string; icon: ReactNode; current: boolean; onSelect: () => void }) {
  return <button type="button" className="oui-nav-item" aria-label={label} title={label} aria-current={current ? 'page' : undefined} onClick={onSelect}>{icon}<span>{label}</span></button>;
}
