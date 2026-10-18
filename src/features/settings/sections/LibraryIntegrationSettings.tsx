import { useCallback,useEffect,useState } from 'react';
import { downloadResponse,readError } from "../../../components/library/library-shared";
import { Button } from '../../../ui';
import { SettingRow,SettingSection } from "../SettingFields";
import { useSettingsConfirm } from '../SettingsConfirm';
import { useClearSensitive,useSettingsFeedback,useSettingsRequest } from '../SettingsState';
import type { SettingsAuthHeaders } from '../types';
interface LibraryTokenStatus {
    exists: boolean;
    active: boolean;
    prefix: string | null;
    createdAt: string | null;
    lastUsedAt: string | null;
    revokedAt: string | null;
}
export function LibraryIntegrationSettings({ authHeaders }: {
    authHeaders: SettingsAuthHeaders;
}) {
    const settingsFetch = useSettingsRequest();
    const feedback = useSettingsFeedback();
    const confirm = useSettingsConfirm();
    const [status, setStatus] = useState<LibraryTokenStatus | null>(null);
    const [token, setToken] = useState('');
    useClearSensitive(() => setToken(''));
    const [busy, setBusy] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [exportBusy, setExportBusy] = useState(false), [exportError, setExportError] = useState('');
    const exportLibrary = async () => {
        setExportBusy(true);
        setExportError('');
        try {
            const response = await settingsFetch('/api/library/export', { headers: authHeaders() });
            if (!response.ok)
                throw await readError(response, '全库导出失败');
            await downloadResponse(response, 'library-export.json');
            feedback.success('全库导出已下载');
        }
        catch (error) {
            setExportError(error instanceof Error ? error.message : '全库导出失败');
        }
        finally {
            setExportBusy(false);
        }
    };
    const loadStatus = useCallback(async () => {
        setLoadError('');
        try {
            const response = await settingsFetch('/api/integrations/library-token', { headers: authHeaders() });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result?.error || '读取知识库令牌状态失败');
            setStatus(result.status);
        }
        catch (error: any) {
            setLoadError(error?.message || '知识库令牌状态加载失败，请重试。');
        }
    }, [authHeaders]);
    useEffect(() => { void loadStatus(); }, [loadStatus]);
    const generate = async () => {
        if (status?.active && !await confirm('生成新令牌会立即使旧令牌失效。是否继续？'))
            return;
        setBusy(true);
        try {
            const response = await settingsFetch('/api/integrations/library-token', { method: 'POST', headers: authHeaders() });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result?.error || '生成知识库令牌失败');
            setToken(result.token || '');
            setStatus(result.status);
            feedback.success('知识库发布令牌已生成，请立即复制保存');
        }
        catch (error: any) {
            feedback.error(error?.message || '生成知识库令牌失败');
        }
        finally {
            setBusy(false);
        }
    };
    const revoke = async () => {
        if (!await confirm('撤销后，本地知识库 V2 将无法继续发布或更新内容。是否继续？'))
            return;
        setBusy(true);
        try {
            const response = await settingsFetch('/api/integrations/library-token', { method: 'DELETE', headers: authHeaders() });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result?.error || '撤销知识库令牌失败');
            setToken('');
            setStatus(result.status);
            feedback.success('知识库发布令牌已撤销');
        }
        catch (error: any) {
            feedback.error(error?.message || '撤销知识库令牌失败');
        }
        finally {
            setBusy(false);
        }
    };
    return (<SettingSection id="library" title="知识库" description="导出与本地知识库发布集成。">
      <SettingRow id="library-full-export" label="导出全库" description="下载当前账号的完整知识库 JSON。"><Button loading={exportBusy} disabled={exportBusy} onClick={exportLibrary}>导出全库</Button>{exportError && <p role="alert" className="orbit-inline-error">{exportError}</p>}</SettingRow>
      <SettingRow label="知识库发布令牌">
        <p className="settings-help">令牌仅用于本地知识库 V2 发布和更新；不能登录或访问其他账号及功能。服务器只保存哈希。</p>
        <div className="settings-status" role="status">
          <strong>{loadError || (status?.active ? '已启用' : status?.exists ? '已撤销' : status ? '尚未生成' : '加载状态中…')}</strong>
          {status?.prefix && <span>令牌前缀：{status.prefix}…</span>}
          {status?.lastUsedAt && <span>最近使用：{new Date(status.lastUsedAt).toLocaleString('zh-CN')}</span>}
          {loadError && <Button variant="secondary" onClick={loadStatus}>重试令牌状态</Button>}
        </div>
        {token && <div className="settings-token-once"><strong>只显示一次</strong><span>关闭设置后无法再次查看明文，请只保存在本地当前 PowerShell 会话中。</span><code>{token}</code><div className="settings-actions"><Button onClick={async () => { try {
        await navigator.clipboard.writeText(token);
        feedback.success('令牌已复制');
    }
    catch {
        feedback.error('自动复制失败，请手动选择令牌');
    } }}>复制令牌</Button></div></div>}
        <div className="settings-actions">
          <Button loading={busy} disabled={!status || !!loadError || busy} onClick={generate}>{status?.active ? '轮换令牌' : '生成令牌'}</Button>
          {status?.active && <Button loading={busy} disabled={busy} onClick={revoke} variant="danger">撤销令牌</Button>}
        </div>
      </SettingRow>
    </SettingSection>);
}
