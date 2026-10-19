import { useCallback,useEffect,useState } from 'react';
import { Button,ExternalLink,Input,PasswordInput } from '../../../ui';
import { SettingRow,SettingSection } from "../SettingFields";
import { useClearSensitive,useSettingsDirty,useSettingsFeedback,useSettingsRequest } from '../SettingsState';
import type { SettingsAuthHeaders } from '../types';
import { CapabilitySettings } from './CapabilitySettings';
import { ChatGPTSettings } from './ChatGPTSettings';
import { ModelSettings } from './ModelSettings';
import { SearchSettings } from './SearchSettings';
interface LoginStatus {
    isLoggedIn: boolean;
    checking: boolean;
    hasApiKey?: boolean;
    usingSharedApi?: boolean;
    apiKey?: string;
    error?: string;
}
export function AiSettings({ authHeaders, isAdmin = false }: {
    authHeaders: SettingsAuthHeaders;
    isAdmin?: boolean;
}) {
    const settingsFetch = useSettingsRequest();
    const feedback = useSettingsFeedback();
    // ---------- 当前账号的 AI 凭据 ----------
    const [showEnvConfig, setShowEnvConfig] = useState(false);
    const [envConfig, setEnvConfig] = useState({
        apiKey: '',
        baseUrl: '',
    });
    useClearSensitive(() => { setEnvConfig(current => ({...current, apiKey: ''})); });
    const [savedBaseUrl,setSavedBaseUrl]=useState('');
    useSettingsDirty('ai-key',showEnvConfig && (!!envConfig.apiKey || envConfig.baseUrl!==savedBaseUrl));
    const [savingEnv, setSavingEnv] = useState(false);
    const [loadingConfig, setLoadingConfig] = useState(false);
    const [loginStatus, setLoginStatus] = useState<LoginStatus>({
        isLoggedIn: false,
        checking: true,
    });
    // 加载当前账号的 API Key
    const loadUserApiKey = useCallback(async () => {
        setLoadingConfig(true);
        try {
            const res = await settingsFetch('/api/user-api-key', { headers: authHeaders() });
            if (!res.ok)
                throw new Error('无法读取 AI 配置');
            const data = await res.json();
            setEnvConfig({ apiKey: '', baseUrl: data.baseUrl || '' });setSavedBaseUrl(data.baseUrl || '');
            return true;
        }
        catch {
            feedback.error('无法读取 AI 配置，请重试');
            return false;
        }
        finally {
            setLoadingConfig(false);
        }
    }, [authHeaders]);
    const checkLoginStatus = useCallback(async () => {
        setLoginStatus(prev => ({ ...prev, checking: true }));
        try {
            const res = await settingsFetch('/api/check-login', {
                headers: authHeaders(),
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
                const data = await res.json();
                setLoginStatus({
                    isLoggedIn: data.isLoggedIn ?? false,
                    checking: false,
                    hasApiKey: data.hasApiKey,
                    usingSharedApi: data.usingSharedApi,
                    apiKey: data.apiKey,
                    error: data.error,
                });
            }
            else {
                setLoginStatus({ isLoggedIn: false, checking: false });
            }
        }
        catch (e: any) {
            if (e.name === 'AbortError' || e.name === 'TimeoutError') {
                setLoginStatus({ isLoggedIn: false, checking: false, error: '检查超时，请重试' });
            }
            else {
                setLoginStatus({ isLoggedIn: false, checking: false, error: '无法连接服务器' });
            }
        }
    }, [authHeaders]);
    // 验证 API Key 可用性
    const [verifying, setVerifying] = useState(false);
    const verifyApiKey = useCallback(async () => {
        setVerifying(true);
        try {
            const res = await settingsFetch('/api/verify-api-key', {
                method: 'POST',
                headers: authHeaders(),
                signal: AbortSignal.timeout(15000)
            });
            const data = await res.json();
            if (data.valid) {
                if (data.quotaExhausted) {
                    // Key 有效但额度用完
                    feedback.warning('API Key 有效，但额度已用完。请前往 CodeBuddy 控制台购买额度。');
                }
                else {
                    feedback.success('API Key 验证成功！可用模型：' + data.modelCount + ' 个');
                }
            }
            else {
                feedback.error(data.error || 'API Key 验证失败');
            }
        }
        catch (e: any) {
            if (e.name === 'TimeoutError') {
                feedback.error('验证超时，请检查网络连接后重试');
            }
            else {
                feedback.error('验证失败：' + (e.message || '未知错误'));
            }
        }
        finally {
            setVerifying(false);
        }
    }, [authHeaders]);
    const saveEnvConfig = async () => {
        if (!envConfig.apiKey.trim()) {
            feedback.warning('请输入 API Key');
            return;
        }
        setSavingEnv(true);
        try {
            const response = await settingsFetch('/api/user-api-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify({
                    apiKey: envConfig.apiKey.trim(),
                    baseUrl: envConfig.baseUrl.trim() || undefined,
                }),
            });
            const data = await response.json();
            if (data.success) {
                feedback.success('API Key 保存成功！');
                setShowEnvConfig(false);
                setEnvConfig({ apiKey: '', baseUrl: '' });
                await checkLoginStatus();
            }
            else {
                feedback.error(data.error || '保存失败');
            }
        }
        catch (error: any) {
            feedback.error(error?.message || '保存失败');
        }
        finally {
            setSavingEnv(false);
        }
    };
    useEffect(() => { void checkLoginStatus(); void loadUserApiKey(); }, [checkLoginStatus, loadUserApiKey]);
    return (<SettingSection id="ai" title="AI 设置" description="配置当前账号的 AI 凭据和日程助手模型。">
      <SettingRow label="AI 连接状态">
        <div className="settings-status" role="status">
          <strong>{loginStatus.checking ? '检查中…' : loginStatus.isLoggedIn ? '已配置' : '未连接'}</strong>
          {!loginStatus.checking && <span>{loginStatus.usingSharedApi ? '使用管理员共享 API，密钥仅在服务器端使用。' : loginStatus.hasApiKey ? `个人 API Key ${loginStatus.apiKey || ''}` : loginStatus.error || '请配置个人 API Key。'}</span>}
          <div className="settings-actions">
            <Button variant="secondary" loading={verifying} disabled={loginStatus.checking || savingEnv} onClick={verifyApiKey}>验证 Key</Button>
            <Button variant="quiet" disabled={loginStatus.checking} onClick={checkLoginStatus}>刷新状态</Button>
          </div>
        </div>
      </SettingRow>
      <SettingRow label="个人 API Key" description="仅保存到当前账号，服务器不使用全局默认 Key。">
        {!showEnvConfig ? <div className="settings-actions">
          <Button variant="secondary" loading={loadingConfig} disabled={loadingConfig || savingEnv} onClick={async () => { if (await loadUserApiKey())
            setShowEnvConfig(true); }}>{loginStatus.hasApiKey && !loginStatus.usingSharedApi ? '修改 API Key' : '配置 API Key'}</Button>
          <ExternalLink href="https://www.workbuddy.cn/profile/keys" target="_blank" rel="noopener noreferrer">打开 WorkBuddy API 管理</ExternalLink>
        </div> : (<div className="settings-credential-form">
            <p className="settings-help">在 <a href="https://www.workbuddy.cn/profile/keys" target="_blank" rel="noopener noreferrer">WorkBuddy API 管理页面</a> 创建或复制 Key，然后粘贴到下方。</p>
            <label className="settings-field-label" htmlFor="settings-api-key">API Key（必填）</label>
            <PasswordInput id="settings-api-key" className="settings-monospace" value={envConfig.apiKey} onChange={(event) => setEnvConfig(prev => ({ ...prev, apiKey: String(event.target.value) }))} placeholder={loginStatus.hasApiKey ? '输入新的 API Key 以覆盖当前配置' : '输入 API Key'} autoComplete="new-password" disabled={savingEnv}/>
            <label className="settings-field-label" htmlFor="settings-base-url">Base URL（可选）</label>
            <Input id="settings-base-url" value={envConfig.baseUrl} onChange={(event) => setEnvConfig(prev => ({ ...prev, baseUrl: String(event.target.value) }))} placeholder="https://api.codebuddy.cn" disabled={savingEnv}/>
            <div className="settings-actions">
              <Button onClick={saveEnvConfig} loading={savingEnv} variant="primary">保存 API Key</Button>
              <Button variant="quiet" disabled={savingEnv} onClick={() => { setShowEnvConfig(false); setEnvConfig({ apiKey: '', baseUrl: '' }); }}>取消</Button>
            </div>
          </div>)}
      </SettingRow>
      <ModelSettings authHeaders={authHeaders}/>
      <ChatGPTSettings authHeaders={authHeaders}/>
      <SearchSettings authHeaders={authHeaders} isAdmin={isAdmin}/>
      <CapabilitySettings authHeaders={authHeaders}/>
    </SettingSection>);
}
