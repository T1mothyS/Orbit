import { useEffect,useRef,useState } from 'react';
import { AccountAvatar } from '../../../components/AccountAvatar';
import { useAuth } from '../../../hooks/useAuth';
import { Button,ConfirmDialog,FilePicker,InlineNotice,useToast } from '../../../ui';

export function AvatarEditor({ email }: { email: string }) {
  const { authHeaders } = useAuth(), toast = useToast();
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [confirm, setConfirm] = useState(false);
  const mounted = useRef(false), locked = useRef(false), controller = useRef<AbortController>();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  const update = async (file?: File) => {
    if (locked.current) return;
    if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) { setError('请选择不超过 5 MB 的 JPEG、PNG 或 WebP 图片。'); return; }
    const headers = authHeaders(), abort = new AbortController(); controller.current = abort;
    locked.current = true; setBusy(true); setError('');
    try {
      const base64 = file ? await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('图片读取失败，请重新选择。')); reader.readAsDataURL(file); }) : undefined;
      if (!mounted.current || abort.signal.aborted) return;
      const response = await fetch('/api/orbit/profile/avatar', { method: file ? 'POST' : 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' }, body: file ? JSON.stringify({ mimeType: file.type, base64 }) : undefined, signal: abort.signal });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '头像保存失败，请重试。');
      if (mounted.current) { window.dispatchEvent(new Event('orbit:profile-change')); toast.show({ title: file ? '头像已更新' : '已恢复默认头像' }); setConfirm(false); }
    } catch (failure) { if (mounted.current && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : '头像保存失败，请重试。'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  return <div className="settings-avatar-editor"><div className="settings-account-actions"><AccountAvatar email={email} size={48} /><FilePicker label={busy ? '保存中…' : '上传或更换'} accept="image/jpeg,image/png,image/webp" disabled={busy} onFile={file => void update(file)} /><Button variant="quiet" disabled={busy} onClick={() => { setError(''); setConfirm(true); }}>恢复默认头像</Button></div>
    <p className="oui-help">JPEG、PNG 或 WebP，最大 5 MB。</p>{error && <InlineNotice tone="danger" title={error} />}
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} busy={busy} title="恢复默认头像？" description="当前头像将被移除，之后可以重新上传。" confirmLabel="恢复默认头像" onConfirm={() => void update()}><p className="oui-help">账号信息和其他设置保持不变。</p>{error && <InlineNotice tone="danger" title={error} />}</ConfirmDialog>
  </div>;
}
