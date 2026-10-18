import type { ReactNode } from 'react';
import './page-frame.css';

/** A constrained content viewport. Workspaces and Settings keep their own scroll owners. */
export function PageFrame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`oui-root orbit-page-frame ${className}`}>{children}</div>;
}
