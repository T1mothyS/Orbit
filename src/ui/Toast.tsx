import type { ReactNode } from 'react';
import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { Toast as PrimitiveToast } from '@base-ui/react/toast';
import { IconButton } from './Button';

export function ToastProvider({ children }: { children: ReactNode }) {
  return <PrimitiveToast.Provider limit={3}><>{children}<ToastViewport /></></PrimitiveToast.Provider>;
}
function ToastViewport() {
  const manager = PrimitiveToast.useToastManager();
  return <PrimitiveToast.Portal><PrimitiveToast.Viewport className="oui-toast-viewport" aria-label="操作反馈">
    {manager.toasts.map(toast => <PrimitiveToast.Root key={toast.id} toast={toast} className={`oui-root oui-toast oui-tone--${toast.type || 'neutral'}`}>
      <PrimitiveToast.Content className="oui-toast-content">
        {toast.type === 'success' ? <CheckCircle2 size={19} aria-hidden="true" /> : <AlertCircle size={19} aria-hidden="true" />}
        <div><PrimitiveToast.Title className="oui-label" />{toast.description && <PrimitiveToast.Description className="oui-help" />}</div>
        <PrimitiveToast.Close aria-hidden={false} render={<IconButton variant="quiet" label="关闭操作反馈"><X size={16} /></IconButton>} />
      </PrimitiveToast.Content>
    </PrimitiveToast.Root>)}
  </PrimitiveToast.Viewport></PrimitiveToast.Portal>;
}
export function useToast() {
  const manager = PrimitiveToast.useToastManager();
  return {
    show: ({ title, description, tone = 'success' }: { title: string; description?: string; tone?: 'success' | 'warning' | 'danger' }) =>
      manager.add({ title, description, type: tone, timeout: tone === 'danger' ? 0 : 5000, priority: tone === 'danger' ? 'high' : 'low' }),
  };
}
