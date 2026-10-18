import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, RefreshCw, Trash2 } from 'lucide-react';
import { Badge, Button, Dialog, EmptyState, InlineNotice, Input, LoadingState, Select, SettingRow, Switch, Tabs, ToastProvider, useToast } from '../ui';
import { useAuth } from '../hooks/useAuth';
import './admin.css';

interface User {
  id: string;
  email: string;
  role: 'admin' | 'user';
  disabled: boolean;
  admin_shared_api_enabled: boolean;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

type InviteRole = 'admin' | 'user';

interface InviteCodeStatus {
  role: InviteRole;
  active: boolean;
  createdAt: string | null;
  rotatedAt: string | null;
  version: number | null;
}

interface LogEntry {
  timestamp: string;
  level: string;
  category: string;
  message: string;
  data?: any;
}

const PRODUCTION_INVITE_COMMAND = `# 在服务器的项目目录中执行；邀请码仅在本机控制台查看
grep -E '^(ADMIN_INVITE_CODE|USER_INVITE_CODE)=' .env`;

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // 某些嵌入式浏览器会暴露 Clipboard API，但拒绝实际写入；继续使用兼容回退。
    }
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.setAttribute('readonly', 'true');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } finally {
    input.remove();
  }
  if (!copied) throw new Error('当前浏览器不支持复制');
}

function UserManagementTab({ mode, onBusyChange }: { mode: 'users' | 'invites'; onBusyChange: (busy: boolean) => void }) {
  const { authHeaders, user: currentUser } = useAuth();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const returnTarget = useRef<HTMLElement | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviteCommandCopied, setInviteCommandCopied] = useState(false);
  const [inviteStatuses, setInviteStatuses] = useState<InviteCodeStatus[]>([]);
  const [inviteLoading, setInviteLoading] = useState(true);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [rotatingInviteRole, setRotatingInviteRole] = useState<InviteRole | null>(null);
  const [revealedInvite, setRevealedInvite] = useState<{ role: InviteRole; code: string; rotatedAt: string } | null>(null);
  const [revealedInviteCopied, setRevealedInviteCopied] = useState(false);

  // 使用 ref 存储 authHeaders 避免无限循环
  const authHeadersRef = React.useRef(authHeaders);
  authHeadersRef.current = authHeaders;

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/users?page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(searchText)}`, {
        headers: authHeadersRef.current(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载用户列表失败');
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载用户列表失败';
      setLoadError(message);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchText]);

  useEffect(() => {
    if (mode === 'users') void loadUsers();
  }, [loadUsers, mode]);

  const loadInviteCodes = useCallback(async () => {
    setInviteLoading(true);
    setInviteError(null);
    try {
      const res = await fetch('/api/admin/invite-codes', {
        headers: authHeadersRef.current(),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '加载邀请码状态失败');
      if (!Array.isArray(data.codes)) throw new Error('邀请码状态格式不正确');
      setInviteStatuses(data.codes as InviteCodeStatus[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : '加载邀请码状态失败';
      setInviteError(message);
    } finally {
      setInviteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === 'invites') void loadInviteCodes();
  }, [loadInviteCodes, mode]);

  const isCurrentAccount = (target: User) => currentUser?.id === target.id;
  const isDangerousActionProtected = (target: User) => isCurrentAccount(target) || target.role === 'admin';
  const actionFailure = (error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : fallback;
    setActionError(message);
  };

  const handleRoleChange = async (userId: string, newRole: 'admin' | 'user') => {
    const actionKey = `${userId}:role`;
    setActionError(null);
    setLoadingAction(actionKey);
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '设置失败');
      toast.show({tone:'success',title:'角色已更新'});
      await loadUsers();
    } catch (error) {
      actionFailure(error, '设置失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleToggleDisabled = async (userId: string, disabled: boolean) => {
    const actionKey = `${userId}:disabled`;
    setActionError(null);
    setLoadingAction(actionKey);
    try {
      const res = await fetch(`/api/admin/users/${userId}/disabled`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        body: JSON.stringify({ disabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '操作失败');
      toast.show({tone:'success',title:disabled ? '已禁用' : '已启用'});
      await loadUsers();
    } catch (error) {
      actionFailure(error, '操作失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleToggleAdminApiSharing = async (user: User) => {
    const previous = Boolean(user.admin_shared_api_enabled);
    const enabled = !previous;
    const actionKey = `${user.id}:api-share`;
    setActionError(null);
    setUsers(current => current.map(row => row.id === user.id ? { ...row, admin_shared_api_enabled: enabled } : row));
    setLoadingAction(actionKey);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/api-share`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '共享 API 权限更新失败');
      const confirmed = typeof data.enabled === 'boolean' ? data.enabled : enabled;
      setUsers(current => current.map(row => row.id === user.id ? { ...row, admin_shared_api_enabled: confirmed } : row));
      if (confirmed && data.adminApiAvailable === false) {
        toast.show({tone:'warning',title:'权限已开启，但当前没有可用的管理员 API Key'});
      } else {
        toast.show({tone:'success',title:confirmed ? '已共享管理员 API' : '已取消共享管理员 API'});
      }
    } catch (error) {
      setUsers(current => current.map(row => row.id === user.id ? { ...row, admin_shared_api_enabled: previous } : row));
      actionFailure(error, '共享 API 权限更新失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const copyInviteCommand = async () => {
    try {
      await copyText(PRODUCTION_INVITE_COMMAND);
      setInviteCommandCopied(true);
      toast.show({tone:'success',title:'已复制'});
      window.setTimeout(() => setInviteCommandCopied(false), 1800);
    } catch {
      toast.show({tone:'danger',title:'自动复制失败，请手动选择命令'});
    }
  };

  const copyRevealedInvite = async () => {
    if (!revealedInvite) return;
    try {
      await copyText(revealedInvite.code);
      setRevealedInviteCopied(true);
      toast.show({tone:'success',title:'新邀请码已复制'});
      window.setTimeout(() => setRevealedInviteCopied(false), 1800);
    } catch {
      toast.show({tone:'danger',title:'自动复制失败，请手动选择新邀请码'});
    }
  };

  const handleRotateInviteCode = async (role: InviteRole) => {
    const roleLabel = role === 'admin' ? '管理员' : '普通用户';
    if (!window.confirm(`确定要轮换${roleLabel}邀请码吗？\n\n旧邀请码会立即失效，已有账号和登录状态不受影响。新邀请码只在成功后显示一次，请及时复制保存。`)) return;

    setInviteError(null);
    setRotatingInviteRole(role);
    try {
      const res = await fetch(`/api/admin/invite-codes/${role}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '轮换邀请码失败');
      if (typeof data.code !== 'string' || !data.code) throw new Error('服务器未返回新邀请码');
      setRevealedInvite({ role, code: data.code, rotatedAt: String(data.rotatedAt || new Date().toISOString()) });
      setRevealedInviteCopied(false);
      setInviteStatuses(current => current.map(status => status.role === role ? {
        ...status,
        active: true,
        createdAt: data.createdAt || status.createdAt,
        rotatedAt: data.rotatedAt || status.rotatedAt,
        version: typeof data.version === 'number' ? data.version : status.version,
      } : status));
      toast.show({tone:'success',title:`${roleLabel}邀请码已轮换`});
    } catch (error) {
      const message = error instanceof Error ? error.message : '轮换邀请码失败';
      setInviteError(message);
    } finally {
      setRotatingInviteRole(null);
    }
  };

  const handleClearData = async (user: User) => {
    if (!window.confirm(`确定要清空用户 ${user.email} 的所有数据吗？\n包括：日程、待办、AI对话历史、API Key 等。\n该用户的账号和密码将保留。`)) return;

    const actionKey = `${user.id}:clear`;
    setActionError(null);
    setLoadingAction(actionKey);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/clear-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        body: JSON.stringify({ confirmEmail: user.email }),
      });
      
      if (res.ok) {
        toast.show({tone:'success',title:`已清空 ${user.email} 的数据`});
      } else {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || '操作失败');
      }
      await loadUsers();
    } catch (error) {
      actionFailure(error, '清空失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (!window.confirm(`⚠️ 危险操作！\n\n确定要删除用户 ${user.email} 吗？\n\n此操作将：\n- 删除该用户的所有日程和待办\n- 删除 AI 对话历史\n- 删除 API Key\n- 删除用户账号\n\n此操作不可恢复！`)) return;

    const actionKey = `${user.id}:delete`;
    setActionError(null);
    setLoadingAction(actionKey);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeadersRef.current() },
        body: JSON.stringify({ confirmEmail: user.email }),
      });
      
      if (res.ok) {
        toast.show({tone:'success',title:`已删除用户 ${user.email}`});
      } else {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || '删除失败');
      }
      await loadUsers();
    } catch (error) {
      actionFailure(error, '删除失败');
    } finally {
      setLoadingAction(null);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const selected = users.find(item => item.id === selectedId);
  useEffect(() => { onBusyChange(!!loadingAction || !!rotatingInviteRole); return () => onBusyChange(false); }, [loadingAction, rotatingInviteRole, onBusyChange]);
  useEffect(() => {
    if (selectedId && !selected && !loading && !loadError) { setSelectedId(null); search.current?.focus(); }
  }, [selectedId, selected, loading, loadError]);
  const openUser = (target: User, trigger: HTMLButtonElement) => { returnTarget.current = trigger; setSelectedId(target.id); };
  const roleBadge = (target: User) => <Badge tone={target.role === 'admin' ? 'brand' : 'neutral'}>{target.role === 'admin' ? '管理员' : '用户'}{isCurrentAccount(target) && ' · 当前账户'}</Badge>;
  const manage = (target: User) => <Button disabled={loading || !!loadingAction} onClick={event => openUser(target, event.currentTarget)} aria-label={`管理账户 ${target.email}`}>管理</Button>;
  if (mode === 'invites') return <div className="admin-invites"><section className="admin-invite-panel">
        <div className="admin-invite-panel-heading">
          <div>
            <h3 className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>邀请码管理</h3>
            <p>按角色手动轮换；旧邀请码会立即失效，已有账号和登录状态不受影响。</p>
          </div>
          <span className="admin-invite-security-note">数据库只保存哈希</span>
        </div>

        {inviteError && (
          <div className="admin-action-error admin-invite-error" role="alert">
            <span>{inviteError}</span>
            <Button size="small" variant="quiet" onClick={() => { void loadInviteCodes(); }}>重试</Button>
          </div>
        )}

        <div className="admin-invite-role-grid" aria-label="邀请码角色状态">
          {(['admin', 'user'] as InviteRole[]).map(role => {
            const status = inviteStatuses.find(item => item.role === role);
            const roleLabel = role === 'admin' ? '管理员' : '普通用户';
            return (
              <div key={role} className="admin-invite-role-card">
                <div className="admin-invite-role-heading">
                  <strong>{roleLabel}邀请码</strong>
                  <span className={status?.active ? 'admin-invite-status active' : 'admin-invite-status'}>
                    {inviteLoading ? '读取中…' : status?.active ? `已启用 · 第 ${status.version || 1} 版` : '未配置'}
                  </span>
                </div>
                <p>{status?.rotatedAt ? `最近轮换：${formatDate(status.rotatedAt)}` : '尚未记录轮换时间'}</p>
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => { void handleRotateInviteCode(role); }}
                  loading={rotatingInviteRole === role}
                  disabled={inviteLoading || !status?.active || (rotatingInviteRole !== null && rotatingInviteRole !== role)}
                >
                  轮换{roleLabel}邀请码
                </Button>
              </div>
            );
          })}
        </div>

        {revealedInvite && (
          <div className="admin-invite-reveal" role="alert">
            <div className="admin-invite-reveal-heading">
              <strong>新{revealedInvite.role === 'admin' ? '管理员' : '普通用户'}邀请码已生成</strong>
              <span>仅在本次操作后显示，请复制保存；关闭后页面不会再次显示。</span>
            </div>
            <div className="admin-invite-reveal-value">
              <code>{revealedInvite.code}</code>
              <Button size="small" variant="secondary" leadingIcon={<Copy size={16}/>} onClick={copyRevealedInvite}>
                {revealedInviteCopied ? '已复制' : '复制新邀请码'}
              </Button>
            </div>
            <Button size="small" variant="quiet" onClick={() => { setRevealedInvite(null); setRevealedInviteCopied(false); }}>
              我已保存，关闭
            </Button>
          </div>
        )}

        <details className="admin-invite-legacy">
          <summary>迁移期查询说明</summary>
          <p>这条命令只查看迁移期 .env 引导配置；数据库初始化或轮换后，当前生效值以数据库记录为准，网页不会读取或回显邀请码明文。</p>
          <p>仅在首次迁移或服务器排障时使用，需要当前电脑已配置 SSH Key 并拥有服务器访问权限。</p>
          <pre className="admin-invite-command"><code>{PRODUCTION_INVITE_COMMAND}</code></pre>
          <div className="admin-invite-command-actions">
            <Button size="small" variant="secondary" leadingIcon={<Copy size={16}/>} onClick={copyInviteCommand}>
              {inviteCommandCopied ? '已复制' : '复制命令'}
            </Button>
          </div>
        </details>
      </section></div>;
  return <div className="admin-user-management">
    <div className="admin-toolbar"><Input ref={search} aria-label="搜索用户邮箱" placeholder="搜索邮箱…" value={searchText} onChange={event => { setSearchText(event.target.value); setPage(1); }} /><Button leadingIcon={<RefreshCw size={16}/>} onClick={() => void loadUsers()} disabled={loading}>刷新</Button><span className="oui-help">共 {total} 个用户</span></div>
    {(loadError || actionError) && <InlineNotice tone="danger" title={loadError || actionError || ''} />}
    {loading && <LoadingState label="正在读取用户…" />}
    {!loading && !users.length && <EmptyState title="没有符合条件的用户" description="调整搜索条件或刷新列表。" />}
    <div className="admin-user-table-wrap"><table className="admin-user-table"><caption className="admin-visually-hidden">账户角色、状态与管理入口</caption><thead><tr><th scope="col">邮箱</th><th scope="col">角色</th><th scope="col">状态</th><th scope="col">共享 API</th><th scope="col">最后登录</th><th scope="col">操作</th></tr></thead><tbody>{users.map(target => <tr key={target.id}><th scope="row">{target.email}</th><td>{roleBadge(target)}</td><td><Badge tone={target.disabled ? 'warning' : 'success'}>{target.disabled ? '已禁用' : '正常'}</Badge></td><td>{target.admin_shared_api_enabled ? '已共享' : '未共享'}</td><td>{formatDate(target.last_login_at)}</td><td>{manage(target)}</td></tr>)}</tbody></table></div>
    <div className="admin-user-mobile-list" aria-label="用户列表">{users.map(target => <article key={target.id} className="admin-user-card"><div className="admin-user-card-head"><strong>{target.email}</strong>{manage(target)}</div><div className="admin-user-card-meta">{roleBadge(target)}<Badge tone={target.disabled ? 'warning' : 'success'}>{target.disabled ? '已禁用' : '正常'}</Badge><span>{target.admin_shared_api_enabled ? '已共享 API' : '未共享 API'}</span></div><p className="oui-help">最近登录 {formatDate(target.last_login_at)}</p></article>)}</div>
    <nav className="admin-pagination" aria-label="用户分页"><span className="oui-help">第 {page} 页 · 共 {Math.max(1, Math.ceil(total / pageSize))} 页</span><div className="admin-page-size"><Select label="每页用户数" value={String(pageSize)} options={[10,20,50].map(count => ({value:String(count),label:`每页 ${count} 个`}))} onValueChange={value => { setPageSize(Number(value || 10)); setPage(1); }} /></div><Button disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button><Button disabled={loading || page * pageSize >= total} onClick={() => setPage(value => value + 1)}>下一页</Button></nav>
    {selected && <Dialog open title={`${selected.email} · 账户管理`} description="角色、共享权限与账号状态" busy={!!loadingAction} returnFocus={returnTarget} onOpenChange={open => { if (!open) setSelectedId(null); }} footer={<Button disabled={!!loadingAction} onClick={() => setSelectedId(null)}>完成</Button>}>
      {(loadError || actionError) && <InlineNotice tone="danger" title={loadError || actionError || ''}>{loadError && <Button disabled={loading} onClick={() => void loadUsers()}>重新读取账户</Button>}</InlineNotice>}
      <dl className="admin-account-facts"><dt>创建时间</dt><dd>{formatDate(selected.created_at)}</dd><dt>最后登录</dt><dd>{formatDate(selected.last_login_at)}</dd></dl>
      <SettingRow label="角色" description={isCurrentAccount(selected) ? '不能修改自己的管理员身份。' : selected.role === 'admin' ? '其他管理员需先降级，才可执行危险操作。' : '按实际需要授予权限。'}><Select label="账户角色" value={selected.role} disabled={isCurrentAccount(selected) || !!loadingAction || loading || !!loadError} onValueChange={value => { if (value && value !== selected.role) void handleRoleChange(selected.id, value as 'admin' | 'user'); }} options={[{value:'admin',label:'管理员'},{value:'user',label:'用户'}]}/></SettingRow>
      <SettingRow label="共享管理员 API" description="控制该账户能否使用管理员共享的 API。"><Switch label="共享管理员 API" checked={selected.admin_shared_api_enabled} disabled={!!loadingAction || loading || !!loadError} onCheckedChange={() => void handleToggleAdminApiSharing(selected)} /><p className="oui-help">{selected.admin_shared_api_enabled ? '已共享' : '未共享'}</p></SettingRow>
      <SettingRow label="账号状态" description={selected.disabled ? '当前账号已禁用。' : '当前账号可正常使用。'}><Button disabled={isDangerousActionProtected(selected) || !!loadingAction || loading || !!loadError} loading={loadingAction === `${selected.id}:disabled`} onClick={() => void handleToggleDisabled(selected.id,!selected.disabled)}>{selected.disabled ? '启用' : '禁用'}</Button></SettingRow>
      <details className="admin-danger-controls"><summary>危险操作</summary><p className="oui-help">{isDangerousActionProtected(selected) ? isCurrentAccount(selected) ? '当前账户受到保护，不能禁用、清空或删除。' : '其他管理员受到保护，请先降级为普通用户。' : '清空保留账号和密码；删除会移除账号与全部数据。执行前仍需确认。'}</p><div className="admin-toolbar"><Button variant="danger" disabled={isDangerousActionProtected(selected) || !!loadingAction || loading || !!loadError} loading={loadingAction === `${selected.id}:clear`} onClick={() => void handleClearData(selected)}>清空数据</Button><Button variant="danger" disabled={isDangerousActionProtected(selected) || !!loadingAction || loading || !!loadError} loading={loadingAction === `${selected.id}:delete`} onClick={() => void handleDeleteUser(selected)}>删除用户</Button></div></details>
    </Dialog>}
  </div>;
}
function DebugLogsTab({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const { authHeaders } = useAuth();
  const toast = useToast();
  const [logError,setLogError] = useState(''), [loading,setLoading] = useState(true), [clearing,setClearing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [category, setCategory] = useState('all');
  const [level, setLevel] = useState('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [total, setTotal] = useState(0);
  const [maxLogs, setMaxLogs] = useState(0);
  const [exporting, setExporting] = useState(false);
  const logContainerRef = React.useRef<HTMLDivElement>(null);
  const intervalRef = React.useRef<number | null>(null);
  useEffect(() => { onBusyChange(clearing || exporting); return () => onBusyChange(false); }, [clearing, exporting, onBusyChange]);

  const fetchLogs = useCallback(async () => {
    setLoading(true); setLogError('');
    try {
      const params = new URLSearchParams({ category, level, limit: '200' });
      const res = await fetch(`/api/logs?${params.toString()}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '日志读取失败');
      setLogs(data.logs || []);
      setTotal(data.total ?? 0);
      setMaxLogs(data.max ?? 0);
    } catch (e) {
      setLogError(e instanceof Error ? e.message : '日志读取失败');
    } finally { setLoading(false); }
  }, [authHeaders, category, level]);

  useEffect(() => {
    void fetchLogs();
    if (autoRefresh) {
      intervalRef.current = window.setInterval(fetchLogs, 2000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchLogs]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  const handleClearLogs = async () => {
    if (clearing || !window.confirm('清空全部调试日志？此操作无法撤销。')) return;
    setClearing(true);setLogError('');
    try {
      const response = await fetch('/api/logs', { method: 'DELETE', headers: authHeaders() });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || '清空失败'); }
      setLogs([]);setTotal(0);toast.show({title:'日志已清空'});
    } catch (error) { setLogError(error instanceof Error ? error.message : '清空失败'); }
    finally { setClearing(false); }
  };

  const handleExportLogs = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await fetch('/api/logs/export?format=txt', { headers: authHeaders() });
      if (!response.ok) {
        let message = '导出失败';
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const disposition = response.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || 'schedule-logs.txt';
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.show({tone:'success',title:'日志已导出'});
    } catch (error) {
      toast.show({tone:'danger',title:error instanceof Error ? error.message : '导出失败'});
    } finally {
      setExporting(false);
    }
  };

  return <div className="admin-logs">
    <div className="admin-toolbar"><label className="admin-auto-refresh"><Switch label="自动刷新日志" checked={autoRefresh} onCheckedChange={setAutoRefresh}/><span>自动刷新</span></label><Button leadingIcon={<RefreshCw size={16}/>} onClick={() => void fetchLogs()} disabled={loading}>刷新</Button><Button leadingIcon={<Download size={16}/>} onClick={() => void handleExportLogs()} loading={exporting}>一键导出</Button><Button variant="quiet" leadingIcon={<Trash2 size={16}/>} onClick={() => void handleClearLogs()} loading={clearing}>清空</Button></div>
    <div className="admin-log-filters"><label>级别<Select label="日志级别筛选" value={level} onValueChange={value => setLevel(value || 'all')} options={[['all','全部'],['info','信息'],['warn','警告'],['error','错误'],['debug','调试']].map(([value,label]) => ({value,label}))}/></label><label>功能<Select label="日志功能筛选" value={category} onValueChange={value => setCategory(value || 'all')} options={[['all','全部'],['schedule','日程'],['reminder','提醒'],['weather','天气'],['ai','AI'],['mail','邮件'],['daily-report','日报'],['library','知识库'],['auth','认证'],['admin','管理'],['db','数据库'],['system','系统']].map(([value,label]) => ({value,label}))}/></label></div>
    {logError && <InlineNotice tone="danger" title={logError}><span>已保留上次读取的记录。</span><Button variant="quiet" onClick={() => void fetchLogs()}>重试读取</Button></InlineNotice>}
    <p className="oui-help" role="status">{loading ? '正在读取日志…' : `已保留 ${total} 条${maxLogs ? `（上限 ${maxLogs} 条，重启后保留）` : ''}`}</p>
    <div ref={logContainerRef} className="admin-log-list" tabIndex={0} aria-label="日志记录，可滚动">{!loading && !logs.length ? <EmptyState title="暂无日志" description="调整筛选条件或等待新的记录。"/> : logs.map((log,index) => <article className="admin-log-row" key={index}><div className="admin-log-main"><time>{log.timestamp}</time><Badge tone={log.level === 'error' ? 'danger' : log.level === 'warn' ? 'warning' : 'neutral'}>{log.level.toUpperCase()}</Badge><Badge>{log.category}</Badge><span>{log.message}</span></div>{log.data && <details className="admin-log-details"><summary>日志数据</summary><pre className="admin-log-data" aria-label="日志数据">{JSON.stringify(log.data,null,2)}</pre></details>}</article>)}</div>
  </div>;
}

export function AdminModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return visible ? <ToastProvider><AdminPanel onClose={onClose}/></ToastProvider> : null;
}
function AdminPanel({ onClose }: { onClose: () => void }) {
  const [tab,setTab] = useState('users'), [busy,setBusy] = useState(false);
  return <Dialog open title="管理面板" size="wide" busy={busy} onOpenChange={open => { if (!open) onClose(); }}>
    <div className="admin-workspace"><Tabs disabled={busy} label="管理面板分区" value={tab} onValueChange={setTab} items={[
      {value:'users',label:'用户管理',content:<UserManagementTab mode="users" onBusyChange={setBusy}/>},
      {value:'invites',label:'邀请码',content:<UserManagementTab mode="invites" onBusyChange={setBusy}/>},
      {value:'logs',label:'调试日志',content:<DebugLogsTab onBusyChange={setBusy}/>},
    ]}/></div>
  </Dialog>;
}
