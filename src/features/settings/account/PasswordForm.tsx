import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStoredAuthHeaders, useAuth } from '../../../hooks/useAuth';
import { Button, FormField, InlineNotice, PasswordInput } from '../../../ui';
import { newPasswordError } from '../../../utils/password-policy';

export function PasswordForm({ onCancel }: { onCancel: () => void }) {
  const { authHeaders, endSession } = useAuth(), navigate = useNavigate();
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({}), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const mounted = useRef(false), request = useRef<AbortController>(), locked = useRef(false), currentInput = useRef<HTMLInputElement>(null), newInput = useRef<HTMLInputElement>(null), confirmInput = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; currentInput.current?.focus(); return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (locked.current) return;
    const validation: Record<string, string> = {};
    if (!current) validation.current = '请输入当前密码。';
    const invalid = newPasswordError(next); if (invalid) validation.next = invalid;
    if (next !== confirm) validation.confirm = '两次新密码不一致。';
    setErrors(validation); setMessage('');
    if (Object.keys(validation).length) { (validation.current ? currentInput : validation.next ? newInput : confirmInput).current?.focus(); return; }
    const headers = authHeaders(), controller = new AbortController(); request.current = controller;
    locked.current = true; setBusy(true);
    const active = () => mounted.current && headers.Authorization === getStoredAuthHeaders().Authorization;
    try {
      const response = await fetch('/api/auth/change-password', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ currentPassword: current, newPassword: next }), signal: controller.signal });
      const result = await response.json(); if (!active()) return;
      if (response.ok) { endSession('密码已更新，请使用新密码重新登录。'); navigate('/login', { replace: true }); return; }
      if (response.status === 401 || response.status === 403 || result.code === 'ACCOUNT_CHANGED') { endSession('登录状态已变化，请重新登录后检查。'); navigate('/login', { replace: true }); return; }
      if (result.code === 'CURRENT_PASSWORD_INVALID') { setErrors({ current: result.error }); setCurrent(''); currentInput.current?.focus(); }
      else if (result.code === 'PASSWORD_UNCHANGED') setErrors({ next: result.error });
      else setMessage(result.error || '暂时无法更新密码，请稍后重试。');
    } catch { if (active() && !controller.signal.aborted) setMessage('修改结果暂时无法确认，请重新登录后检查密码，再重试。'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  return <form className="settings-password-form" onSubmit={submit} noValidate aria-label="修改登录密码" aria-busy={busy || undefined}>
    <FormField id="account-current-password" label="当前密码" error={errors.current}><PasswordInput id="account-current-password" name="current-password" ref={currentInput} aria-label="当前密码" autoComplete="current-password" value={current} onChange={event => setCurrent(event.target.value)} disabled={busy} aria-invalid={!!errors.current} aria-describedby={errors.current ? 'account-current-password-description' : undefined} /></FormField>
    <FormField id="account-new-password" label="新密码" hint="至少 8 位；中文等字符会占用多个字节，总计最多 72 字节。" error={errors.next}><PasswordInput id="account-new-password" name="new-password" ref={newInput} aria-label="新密码" autoComplete="new-password" value={next} onChange={event => setNext(event.target.value)} disabled={busy} aria-invalid={!!errors.next} aria-describedby="account-new-password-description" /></FormField>
    <FormField id="account-confirm-password" label="确认新密码" error={errors.confirm}><PasswordInput id="account-confirm-password" name="confirm-password" ref={confirmInput} aria-label="确认新密码" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} disabled={busy} aria-invalid={!!errors.confirm} aria-describedby={errors.confirm ? 'account-confirm-password-description' : undefined} /></FormField>
    {message && <InlineNotice tone="danger" title={message} />}
    <p className="oui-help">更新后，所有设备上的 Orbit 登录都会失效。日报、知识库令牌和外部授权仍然保留。</p>
    <div className="settings-account-actions"><Button type="submit" variant="primary" loading={busy}>更新并重新登录</Button><Button disabled={busy} onClick={onCancel}>取消</Button></div>
  </form>;
}
