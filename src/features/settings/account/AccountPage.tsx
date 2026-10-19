import { useEffect,useRef,useState } from 'react';
import { useLocation,useNavigate } from 'react-router-dom';
import { useAuth } from '../../../hooks/useAuth';
import { Badge,Button,ConfirmDialog,Section,TextLink } from '../../../ui';
import { SettingRow } from '../SettingFields';
import { AvatarEditor } from './AvatarEditor';
import { PasswordForm } from './PasswordForm';
import './account.css';

export default function AccountPage() {
  const { user, logout } = useAuth(), navigate = useNavigate();
  const [editing, setEditing] = useState(false), [confirm, setConfirm] = useState(false);
  const passwordTrigger = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  useEffect(() => { if (new URLSearchParams(location.search).get('settings') === 'account-password') setEditing(true); }, [location.search]);
  if (!user) return null;
  return <>
    <Section title="账号信息" id="settings-account">
      <SettingRow id="setting-account-i5oc5l" label="用户头像" description="为你的个人空间选一张头像。支持 JPEG、PNG 或 WebP，最大 5 MB。"><AvatarEditor key={user.id} email={user.email} /></SettingRow>
      <SettingRow id="setting-account-m2enu0" label="登录邮箱"><div className="settings-account-identity"><strong>{user.email}</strong><Badge>{user.role === 'admin' ? '管理员' : '普通用户'}</Badge></div><code id="setting-account-3jrccd" tabIndex={-1} className="settings-account-id">ID · {user.id}</code></SettingRow>
      <SettingRow label="个人资料" description="身份、背景、专业兴趣与表达偏好。目前用于 Cloud 日报。"><TextLink to="/settings/account/profile">编辑个人资料</TextLink></SettingRow>
    </Section>
    <Section title="登录与安全">
      <SettingRow id="account-password" label="登录密码" description="更新时需要验证当前密码。更新后所有设备上的 Orbit 登录都会失效，日报、知识库令牌和外部授权仍然保留。">{editing ? <PasswordForm onCancel={() => { setEditing(false); requestAnimationFrame(() => passwordTrigger.current?.focus()); }} /> : <Button ref={passwordTrigger} onClick={() => setEditing(true)}>修改密码</Button>}</SettingRow>
      <SettingRow id="setting-account-1icbw7k" label="当前登录" description="退出后，本机需要重新登录。"><div className="settings-account-actions"><Badge tone="success">已登录</Badge><Button variant="danger" onClick={() => setConfirm(true)}>退出当前登录</Button></div></SettingRow>
    </Section>
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="退出当前登录？" description="本机的未发送对话草稿将清空。" confirmLabel="退出登录" onConfirm={() => { logout(); navigate('/login', { replace: true }); }}><p className="oui-help">账号数据和其他设备的登录不受此操作影响。</p></ConfirmDialog>
  </>;
}
