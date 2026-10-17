import { Link as RouterLink } from 'react-router-dom';
import type { ReactNode } from 'react';

export function TextLink({ to, state, children }: { to: string; state?: unknown; children: ReactNode }) {
  return <RouterLink to={to} state={state} className="oui-text-link">{children}</RouterLink>;
}
