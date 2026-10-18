import { createContext,useContext,useEffect,useRef,useState,type ReactNode } from 'react';
import { ConfirmDialog } from '../../ui';
const Confirmation = createContext<(description: string) => Promise<boolean>>(async () => false);
export const useSettingsConfirm = () => useContext(Confirmation);
export function SettingsConfirmProvider({ children }: { children: ReactNode }) {
  const [description, setDescription] = useState('');
  const resolver = useRef<(accepted: boolean) => void>();
  const finish = (accepted: boolean) => { resolver.current?.(accepted); resolver.current = undefined; setDescription(''); };
  useEffect(() => () => { resolver.current?.(false); }, []);
  return <Confirmation.Provider value={text => new Promise(resolve => { resolver.current?.(false); resolver.current = resolve; setDescription(text); })}>
    {children}<ConfirmDialog open={!!description} onOpenChange={open => { if (!open) finish(false); }} title="确认操作" description={description} confirmLabel="确认继续" onConfirm={() => finish(true)}><p className="oui-help">请核对影响范围，取消不会执行本次操作。</p></ConfirmDialog>
  </Confirmation.Provider>;
}
