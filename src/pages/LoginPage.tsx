/**
 * 登录/注册页面
 */
import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { Button, Input, MessagePlugin } from 'tdesign-react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';

type Mode = 'login' | 'register';

function getSafeNextPath(pathname: string, search: string): string | null {
  const queryNext = new URLSearchParams(search).get('next');
  const candidate = queryNext || (/^\/(tools|project|reports)(\/|$)/.test(pathname) ? `${pathname}${search}` : null);
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

  const { login, register, sendRegisterCode, isAuthenticated } = useAuth();
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
    if (!email || !password || !inviteCode) {
      MessagePlugin.warning('请先填写邮箱、密码和邀请码');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      MessagePlugin.warning('请输入有效的邮箱地址');
      return;
    }
    if (password.length < 8) {
      MessagePlugin.warning('密码至少8位');
      return;
    }
    setSending(true);
    try {
      await sendRegisterCode(email, password, inviteCode);
      MessagePlugin.success('验证码已发送到您的邮箱');
      setCodeSent(true);
      setCodeCountdown(60);
    } catch (e: any) {
      MessagePlugin.error(e.message);
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
        MessagePlugin.warning('请填写邮箱和密码');
        return;
      }
      setLoading(true);
      try {
        await login(email, password);
        MessagePlugin.success('登录成功！');
        // 强制刷新确保所有全局状态重置
        window.location.href = nextPath || '/assistant';
      } catch (e: any) {
        setError(e.message || '登录失败，请重试');
      } finally {
        setLoading(false);
      }
    } else {
      if (!email || !password || !code || !inviteCode) {
        MessagePlugin.warning('请填写完整信息');
        return;
      }
      if (password !== confirmPassword) {
        MessagePlugin.warning('两次密码不一致');
        return;
      }
      if (password.length < 8) {
        MessagePlugin.warning('密码至少8位');
        return;
      }
      setLoading(true);
      try {
        await register(email, password, code, inviteCode);
        MessagePlugin.success('注册成功！');
      } catch (e: any) {
        setError(e.message || '注册失败，请重试');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="orbit-login-page min-h-screen flex flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/orbit-logo.png" alt="" className="orbit-login-logo" /><h1 className="text-3xl font-bold mb-1">Orbit</h1>
          <p className="text-sm">以对话为入口，管理你的个人事务</p>
        </div>

        {/* 表单卡片 */}
        <div className="orbit-login-card p-8">
          {/* Tab 切换 */}
          <div className="flex mb-6 bg-gray-100 rounded-lg p-1">
            <button
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${mode === 'login' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => { setMode('login'); setError(''); }} disabled={loading || sending} aria-pressed={mode === 'login'}
            >
              登录
            </button>
            <button
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${mode === 'register' ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
              onClick={() => { setMode('register'); setError(''); }} disabled={loading || sending} aria-pressed={mode === 'register'}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="orbit-inline-error" role="alert">{error}</p>}
            <label className="block">
              <span className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>邮箱</span>
              <Input
                autocomplete="email"
                value={email}
                onChange={(v) => setEmail(v as string)}
                placeholder="请输入邮箱地址"
                size="large"
              />
            </label>

            <label className="block">
              <span className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>密码</span>
              <Input
                value={password}
                onChange={(v) => setPassword(v as string)}
                placeholder={mode === 'register' ? '至少8位' : '请输入密码'}
                autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
                size="large"
                type="password"
              />
            </label>

            {mode === 'register' && (
              <>
                <label className="block">
                  <span className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>确认密码</span>
                  <Input
                    value={confirmPassword}
                    onChange={(v) => setConfirmPassword(v as string)}
                    placeholder="再次输入密码"
                    size="large"
                    type="password"
                    autocomplete="new-password"
                  />
                </label>

                <label className="block">
                  <span className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>邀请码</span>
                  <Input
                    value={inviteCode}
                    onChange={(v) => setInviteCode(v as string)}
                    placeholder="请输入邀请码"
                    size="large"
                  />
                </label>

                <div>
                  <div className="flex gap-2 items-end">
                    <label className="flex-1 min-w-0">
                      <span className="block text-sm font-medium mb-1.5" style={{ color: 'var(--td-text-color-primary)' }}>邮箱验证码</span>
                      <Input
                        value={code}
                        onChange={(v) => setCode(v as string)}
                        placeholder="输入6位验证码"
                        size="large"
                        maxlength={6}
                        autocomplete="one-time-code"
                      />
                    </label>
                    <Button
                      onClick={handleSendCode}
                      loading={sending}
                      disabled={codeCountdown > 0}
                      variant="outline"
                      style={{ flexShrink: 0 }}
                    >
                      {codeCountdown > 0 ? `${codeCountdown}s` : '获取验证码'}
                    </Button>
                  </div>
                  {!codeSent && (
                    <div className="mt-1 text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                      点击「获取验证码」前请先填好邮箱、密码和邀请码
                    </div>
                  )}
                </div>
              </>
            )}

            <Button
              type="submit"
              variant="base"
              block
              size="large"
              loading={loading}
              style={{ background: 'var(--td-brand-color)', color: '#fff', border: 'none', marginTop: '8px' }}
            >
              {mode === 'login' ? '登 录' : '完 成 注 册'}
            </Button>
          </form>

          {mode === 'login' && (
            <div className="mt-4 text-center">
              <p className="text-xs" style={{ color: 'var(--td-text-color-secondary)' }}>
                还没有账号？<button className="text-blue-500 hover:underline" onClick={() => setMode('register')}>立即注册</button>
              </p>
            </div>
          )}
        </div>

          <p className="text-center text-xs mt-6">
            Orbit © 2026
          </p>
        </div>
      </main>

      <footer className="flex-none px-4 pb-5 text-center text-xs">
        <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer">
          冀ICP备2026028167号
        </a>
      </footer>
    </div>
  );
}
