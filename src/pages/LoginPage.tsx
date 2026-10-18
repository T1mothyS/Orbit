/**
 * 登录/注册页面
 */
import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { Button, FormField, InlineNotice, Input, PasswordInput, Tabs } from '../ui';
import './login.css';
import { newPasswordError } from '../utils/password-policy';

type Mode = 'login' | 'register';

function getSafeNextPath(pathname: string, search: string): string | null {
  const queryNext = new URLSearchParams(search).get('next');
  const candidate = queryNext || (/^\/(tools|project|reports|assistant|schedule|reminders|library|today|settings|help)(\/|$)/.test(pathname) ? `${pathname}${search}` : null);
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return null;
  try {
    const url = new URL(candidate, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function LoginPage() {
  useTheme();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [feedback,setFeedback] = useState('');
  const errorTarget = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorTarget.current?.focus(); }, [error]);

  const { login, register, sendRegisterCode, isAuthenticated, notice } = useAuth();
  const location = useLocation();
  const nextPath = getSafeNextPath(location.pathname, location.search);

  // 工具页面是受保护的原始 HTML，登录后需要完整跳转让服务器交付文件。
  useEffect(() => {
    if (isAuthenticated) {
      window.location.replace(nextPath || '/assistant');
    }
  }, [isAuthenticated, nextPath]);

  // 倒计时
  useEffect(() => {
    if (codeCountdown > 0) {
      const t = setTimeout(() => setCodeCountdown(codeCountdown - 1), 1000);
      return () => clearTimeout(t);
    }
  }, [codeCountdown]);

  const handleSendCode = async () => {
    setError('');setFeedback('');
    if (!email || !password || !inviteCode) {
      setError('请先填写邮箱、密码和邀请码');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    const invalid = newPasswordError(password);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSending(true);
    try {
      await sendRegisterCode(email, password, inviteCode);
      setFeedback('验证码已发送到您的邮箱');
      setCodeSent(true);
      setCodeCountdown(60);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    if (mode === 'login') {
      if (!email || !password) {
        setError('请填写邮箱和密码');
        return;
      }
      setLoading(true);
      try {
        await login(email, password);
        // 强制刷新确保所有全局状态重置
        window.location.href = nextPath || '/assistant';
      } catch (e: any) {
        setError(e.message || '登录失败，请重试');
      } finally {
        setLoading(false);
      }
    } else {
      if (!email || !password || !code || !inviteCode) {
        setError('请填写完整信息');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次密码不一致');
        return;
      }
      const invalid = newPasswordError(password);
      if (invalid) {
        setError(invalid);
        return;
      }
      setLoading(true);
      try {
        await register(email, password, code, inviteCode);
      } catch (e: any) {
        setError(e.message || '注册失败，请重试');
      } finally {
        setLoading(false);
      }
    }
  };

  const form = <form onSubmit={handleSubmit} className="login-form" aria-busy={loading || sending}>
    {notice && <InlineNotice title={notice}/>}{feedback && <InlineNotice title={feedback}/>}
    {error && <div ref={errorTarget} tabIndex={-1}><InlineNotice tone="danger" title={error}/></div>}
    <FormField id="login-email" label="邮箱"><Input id="login-email" inputMode="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="请输入邮箱地址" disabled={loading || sending}/></FormField>
    <FormField id="login-password" label="密码"><PasswordInput key={mode} id="login-password" aria-label="密码" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'register' ? '至少8位，最多72字节' : '请输入密码'} disabled={loading || sending}/></FormField>
    {mode === 'register' && <>
      <FormField id="register-confirm" label="确认密码"><PasswordInput id="register-confirm" aria-label="确认密码" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} placeholder="再次输入密码" autoComplete="new-password" disabled={loading || sending}/></FormField>
      <FormField id="register-invite" label="邀请码"><Input id="register-invite" value={inviteCode} onChange={event => setInviteCode(event.target.value)} placeholder="请输入邀请码" autoComplete="off" disabled={loading || sending}/></FormField>
      <div><div className="login-code-row"><FormField id="register-code" label="邮箱验证码"><Input id="register-code" value={code} onChange={event => setCode(event.target.value)} placeholder="输入6位验证码" inputMode="numeric" maxLength={6} autoComplete="one-time-code" disabled={loading || sending}/></FormField><Button onClick={() => void handleSendCode()} loading={sending} disabled={loading || codeCountdown > 0}>{codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码'}</Button></div>{!codeSent && <p className="oui-help login-code-hint">点击“获取验证码”前请先填写邮箱、密码和邀请码。</p>}</div>
    </>}
    <Button type="submit" variant="primary" loading={loading} disabled={sending} className="login-submit">{mode === 'login' ? '登录' : '完成注册'}</Button>
  </form>;
  return <div className="oui-root orbit-login-page"><main className="login-main"><div className="login-content"><header className="login-brand"><img src="/orbit-logo.png" alt=""/><h1>Orbit</h1><p>以对话为入口，管理你的个人事务</p></header><section className="orbit-login-card"><Tabs label="登录方式" value={mode} disabled={loading || sending} onValueChange={value => { if(value==='login'||value==='register'){setMode(value);setError('');setFeedback('');} }} items={[{value:'login',label:'登录',content:mode === 'login' ? form : null},{value:'register',label:'注册',content:mode === 'register' ? form : null}]}/></section><p className="login-copyright">Orbit © 2026</p></div></main><footer className="login-footer"><a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">冀ICP备2026028167号</a></footer></div>;
}
