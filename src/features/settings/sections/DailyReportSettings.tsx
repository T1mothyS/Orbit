import { useCallback,useEffect,useState } from 'react';
import { Button,Switch } from '../../../ui';
import { SettingRow,SettingSection } from "../SettingFields";
import { useSettingsConfirm } from '../SettingsConfirm';
import { useClearSensitive,useSettingsDirty,useSettingsFeedback,useSettingsRequest } from '../SettingsState';
import type { DailyReportTokenStatus,SettingsAuthHeaders } from '../types';
interface DailyReportCloudContextEnvelope {
    version: number;
    context: Record<string, unknown>;
    createdAt: string | null;
    updatedAt: string | null;
    readFailed: boolean;
}
type DailyReportSource = 'local' | 'cloud';
interface DailyReportDeliveryPolicy {
    sources: DailyReportSource[];
    updatedAt: string | null;
}
export function DailyReportSettings({authHeaders}:{authHeaders:SettingsAuthHeaders}) {
    const settingsFetch = useSettingsRequest();
    const feedback = useSettingsFeedback();
    const confirm = useSettingsConfirm();
    const [dailyReportStatus, setDailyReportStatus] = useState<DailyReportTokenStatus | null>(null);
    const [dailyReportToken, setDailyReportToken] = useState('');
    useClearSensitive(() => setDailyReportToken(''));
    const [dailyReportBusy, setDailyReportBusy] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [deliveryPolicy, setDeliveryPolicy] = useState<DailyReportDeliveryPolicy | null>(null);
    const [deliverySources, setDeliverySources] = useState<DailyReportSource[]>(['local']);
    const [deliveryPolicyBusy, setDeliveryPolicyBusy] = useState(false);
    const [deliveryPolicyError, setDeliveryPolicyError] = useState('');
    const loadDailyReportStatus = useCallback(async () => {
        setLoadError('');
        try {
            const response = await settingsFetch('/api/integrations/daily-report-token', { headers: authHeaders() });
            if (!response.ok)
                throw new Error('读取令牌状态失败');
            const result = await response.json();
            setDailyReportStatus(result.status);
        }
        catch {
            setLoadError('日报令牌状态加载失败，请重试。');
        }
    }, [authHeaders]);
    const loadDeliveryPolicy = useCallback(async () => {
        setDeliveryPolicyError('');
        try {
            const response = await settingsFetch('/api/daily-report/delivery-policy', { headers: authHeaders() });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result?.error || '读取日报来源设置失败');
            const sources = Array.isArray(result.sources)
                ? result.sources.filter((source: unknown): source is DailyReportSource => source === 'local' || source === 'cloud')
                : ['local'];
            setDeliveryPolicy({ sources, updatedAt: result.updatedAt || null });
            setDeliverySources(sources);
        }
        catch (error: any) {
            setDeliveryPolicyError(error?.message || '日报来源设置加载失败，请重试。');
        }
    }, [authHeaders]);
    const generateReportToken = async () => {
        if (dailyReportStatus?.active && !await confirm('生成新令牌会立即使旧令牌失效。是否继续？'))
            return;
        setDailyReportBusy(true);
        try {
            const response = await settingsFetch('/api/integrations/daily-report-token', { method: 'POST', headers: authHeaders() });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result.error || '生成令牌失败');
            setDailyReportToken(result.token);
            setDailyReportStatus(result.status);
            feedback.success('日报令牌已生成，请立即复制保存');
        }
        catch (error: any) {
            feedback.error(error?.message || '生成令牌失败');
        }
        finally {
            setDailyReportBusy(false);
        }
    };
    const revokeReportToken = async () => {
        if (!await confirm('撤销后，日报项目将无法读取日程、邮箱摘要或发布日报。是否继续？'))
            return;
        setDailyReportBusy(true);
        try {
            const response = await settingsFetch('/api/integrations/daily-report-token', { method: 'DELETE', headers: authHeaders() });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result.error || '撤销令牌失败');
            setDailyReportToken('');
            setDailyReportStatus(result.status);
            feedback.success('日报令牌已撤销');
        }
        catch (error: any) {
            feedback.error(error?.message || '撤销令牌失败');
        }
        finally {
            setDailyReportBusy(false);
        }
    };
    const toggleDeliverySource = (source: DailyReportSource, enabled: boolean) => {
        setDeliverySources(current => {
            const next = new Set(current);
            if (enabled)
                next.add(source);
            else
                next.delete(source);
            return (['local', 'cloud'] as DailyReportSource[]).filter(item => next.has(item));
        });
    };
    const saveDeliveryPolicy = async () => {
        setDeliveryPolicyBusy(true);
        setDeliveryPolicyError('');
        try {
            const response = await settingsFetch('/api/daily-report/delivery-policy', {
                method: 'PUT',
                headers: { ...authHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ sources: deliverySources }),
            });
            const result = await response.json();
            if (!response.ok)
                throw new Error(result?.error || '保存日报来源设置失败');
            const sources = Array.isArray(result.sources)
                ? result.sources.filter((source: unknown): source is DailyReportSource => source === 'local' || source === 'cloud')
                : [];
            setDeliveryPolicy({ sources, updatedAt: result.updatedAt || null });
            setDeliverySources(sources);
            feedback.success('日报来源接收设置已保存');
        }
        catch (error: any) {
            setDeliveryPolicyError(error?.message || '保存日报来源设置失败，请重试。');
        }
        finally {
            setDeliveryPolicyBusy(false);
        }
    };
    useEffect(() => { void loadDailyReportStatus(); void loadDeliveryPolicy(); }, [loadDailyReportStatus, loadDeliveryPolicy]);
    const deliveryPolicyDirty = deliveryPolicy
        ? deliverySources.join(',') !== deliveryPolicy.sources.join(',')
        : false;
    useSettingsDirty('report-delivery',deliveryPolicyDirty);
    return (<SettingSection id="daily-report" title="日报集成" description="令牌允许读取当前账号的日程与 QQ 未读摘要，以及上传日报媒体、发布日报。不能修改日程，也不会返回邮箱授权码、附件、密码或 API Key。">
      <SettingRow label="日报令牌">
        <div className="settings-status" role="status">
          <strong>{loadError || (dailyReportStatus?.active ? '已启用' : dailyReportStatus?.exists ? '已撤销' : dailyReportStatus ? '尚未生成' : '加载状态中…')}</strong>
          {dailyReportStatus?.prefix && <span>令牌前缀：{dailyReportStatus.prefix}…</span>}
          {dailyReportStatus?.lastUsedAt && <span>最近使用：{new Date(dailyReportStatus.lastUsedAt).toLocaleString('zh-CN')}</span>}
          {loadError && <Button variant="secondary" onClick={loadDailyReportStatus}>重试令牌状态</Button>}
        </div>
        {dailyReportToken && <div className="settings-token-once"><strong>只显示一次</strong><span>关闭设置后无法再次查看明文，请立即保存。</span><code>{dailyReportToken}</code><div className="settings-actions"><Button onClick={async () => { try {
        await navigator.clipboard.writeText(dailyReportToken);
        feedback.success('令牌已复制');
    }
    catch {
        feedback.error('自动复制失败，请手动选择令牌');
    } }}>复制令牌</Button></div></div>}
        <div className="settings-actions">
          <Button loading={dailyReportBusy} disabled={!dailyReportStatus || !!loadError || dailyReportBusy} onClick={generateReportToken}>{dailyReportStatus?.active ? '轮换令牌' : '生成令牌'}</Button>
          {dailyReportStatus?.active && <Button loading={dailyReportBusy} disabled={dailyReportBusy} onClick={revokeReportToken} variant="danger">撤销令牌</Button>}
        </div>
      </SettingRow>
      <SettingRow label="来源接收与转发" description="只控制哪些已写入生产服务器的日报进入正式网页和邮件；不会暂停本地或 Work Cloud 任务。保存后从下一次正式发布生效，不追溯发送。">
        <div className="settings-stack">
          {deliveryPolicyError && <div className="settings-status" role="alert"><strong className="settings-error-text">{deliveryPolicyError}</strong><Button variant="secondary" onClick={() => void loadDeliveryPolicy()}>重试来源设置</Button></div>}
          {!deliveryPolicy && !deliveryPolicyError && <p className="settings-help" role="status">加载来源接收设置中…</p>}
          <div className="settings-switches" aria-label="日报来源接收设置">
            <label>
              <Switch label="接收并转发本地日报" checked={deliverySources.includes('local')} disabled={!deliveryPolicy || deliveryPolicyBusy} onCheckedChange={value => toggleDeliverySource('local', Boolean(value))}/>
              <span>接收并转发本地日报</span>
            </label>
            <label>
              <Switch label="接收并转发 Cloud 日报" checked={deliverySources.includes('cloud')} disabled={!deliveryPolicy || deliveryPolicyBusy} onCheckedChange={value => toggleDeliverySource('cloud', Boolean(value))}/>
              <span>接收并转发 Cloud 日报</span>
            </label>
          </div>
          <div className="settings-actions">
            <Button loading={deliveryPolicyBusy} disabled={!deliveryPolicy || !deliveryPolicyDirty || deliveryPolicyBusy} onClick={() => void saveDeliveryPolicy()}>保存来源设置</Button>
          </div>
          {deliveryPolicy && <p className="settings-note">当前选择：{deliveryPolicy.sources.length ? deliveryPolicy.sources.map(source => source === 'local' ? '本地' : 'Cloud').join('、') : '不接收任何来源'}。未勾选的有效日报仍会保存为候选，可在日报页查看对照；两边都勾选时会分别发送两封邮件。最近保存：{deliveryPolicy.updatedAt ? new Date(deliveryPolicy.updatedAt).toLocaleString('zh-CN') : '尚未保存'}。</p>}
          <div className="settings-guide-card">
            <h3>正式切换步骤</h3>
            <ol>
              <li>在 Work Cloud 中授权当前生产环境的 <code>{window.location.origin}/mcp</code>。</li>
              <li>先用 <code>dry_run:true</code> 完成至少三个日期的 Shadow，并确认媒体和结构通过。</li>
              <li>确认无误后，定时任务改用 <code>dry_run:false</code>；返回 <code>PUBLISHED</code> 才代表已写入生产服务器。</li>
              <li>回到这里勾选 Cloud 并保存；需要双跑时同时勾选本地和 Cloud。</li>
            </ol>
          </div>
        </div>
      </SettingRow>

    </SettingSection>);
}
