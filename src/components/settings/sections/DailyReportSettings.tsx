import { useState, useEffect, useCallback } from 'react';
import { Button, MessagePlugin, Switch } from 'tdesign-react';
import { SettingSection } from '../SettingSection';
import { SettingRow } from '../SettingRow';
import type { DailyReportTokenStatus, SettingsAuthHeaders } from '../types';

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

export function DailyReportSettings({ authHeaders, onOpenPreferences, showContext = true }: { authHeaders: SettingsAuthHeaders; onOpenPreferences?: () => void; showContext?: boolean }) {
  const [dailyReportStatus, setDailyReportStatus] = useState<DailyReportTokenStatus | null>(null);
  const [dailyReportToken, setDailyReportToken] = useState('');
  const [dailyReportBusy, setDailyReportBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [cloudContext, setCloudContext] = useState<DailyReportCloudContextEnvelope | null>(null);
  const [cloudContextError, setCloudContextError] = useState('');
  const [deliveryPolicy, setDeliveryPolicy] = useState<DailyReportDeliveryPolicy | null>(null);
  const [deliverySources, setDeliverySources] = useState<DailyReportSource[]>(['local']);
  const [deliveryPolicyBusy, setDeliveryPolicyBusy] = useState(false);
  const [deliveryPolicyError, setDeliveryPolicyError] = useState('');
  const loadDailyReportStatus = useCallback(async () => {
    setLoadError('');
    try {
      const response = await fetch('/api/integrations/daily-report-token', { headers: authHeaders() });
      if (!response.ok) throw new Error('读取令牌状态失败');
      const result = await response.json();
      setDailyReportStatus(result.status);
    } catch { setLoadError('日报令牌状态加载失败，请重试。'); }
  }, [authHeaders]);

  const loadDeliveryPolicy = useCallback(async () => {
    setDeliveryPolicyError('');
    try {
      const response = await fetch('/api/daily-report/delivery-policy', { headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || '读取日报来源设置失败');
      const sources = Array.isArray(result.sources)
        ? result.sources.filter((source: unknown): source is DailyReportSource => source === 'local' || source === 'cloud')
        : ['local'];
      setDeliveryPolicy({ sources, updatedAt: result.updatedAt || null });
      setDeliverySources(sources);
    } catch (error: any) {
      setDeliveryPolicyError(error?.message || '日报来源设置加载失败，请重试。');
    }
  }, [authHeaders]);

  const loadCloudContext = useCallback(async () => {
    setCloudContextError('');
    try {
      const response = await fetch('/api/daily-report/cloud-context', { headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || '读取云端 Context 状态失败');
      setCloudContext(result.context as DailyReportCloudContextEnvelope);
    } catch (error: any) {
      setCloudContextError(error?.message || '云端 Context 状态加载失败，请重试。');
    }
  }, [authHeaders]);

  const generateReportToken = async () => {
    if (dailyReportStatus?.active && !window.confirm('生成新令牌会立即使旧令牌失效。是否继续？')) return;
    setDailyReportBusy(true);
    try {
      const response = await fetch('/api/integrations/daily-report-token', { method: 'POST', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '生成令牌失败');
      setDailyReportToken(result.token);
      setDailyReportStatus(result.status);
      MessagePlugin.success('日报令牌已生成，请立即复制保存');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '生成令牌失败');
    } finally {
      setDailyReportBusy(false);
    }
  };

  const revokeReportToken = async () => {
    if (!window.confirm('撤销后，日报项目将无法读取日程、邮箱摘要或发布日报。是否继续？')) return;
    setDailyReportBusy(true);
    try {
      const response = await fetch('/api/integrations/daily-report-token', { method: 'DELETE', headers: authHeaders() });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '撤销令牌失败');
      setDailyReportToken('');
      setDailyReportStatus(result.status);
      MessagePlugin.success('日报令牌已撤销');
    } catch (error: any) {
      MessagePlugin.error(error?.message || '撤销令牌失败');
    } finally {
      setDailyReportBusy(false);
    }
  };

  const toggleDeliverySource = (source: DailyReportSource, enabled: boolean) => {
    setDeliverySources(current => {
      const next = new Set(current);
      if (enabled) next.add(source);
      else next.delete(source);
      return (['local', 'cloud'] as DailyReportSource[]).filter(item => next.has(item));
    });
  };

  const saveDeliveryPolicy = async () => {
    setDeliveryPolicyBusy(true);
    setDeliveryPolicyError('');
    try {
      const response = await fetch('/api/daily-report/delivery-policy', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ sources: deliverySources }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || '保存日报来源设置失败');
      const sources = Array.isArray(result.sources)
        ? result.sources.filter((source: unknown): source is DailyReportSource => source === 'local' || source === 'cloud')
        : [];
      setDeliveryPolicy({ sources, updatedAt: result.updatedAt || null });
      setDeliverySources(sources);
      MessagePlugin.success('日报来源接收设置已保存');
    } catch (error: any) {
      setDeliveryPolicyError(error?.message || '保存日报来源设置失败，请重试。');
    } finally {
      setDeliveryPolicyBusy(false);
    }
  };

  useEffect(() => { void loadDailyReportStatus(); if (showContext) void loadCloudContext(); void loadDeliveryPolicy(); }, [loadDailyReportStatus, loadCloudContext, loadDeliveryPolicy, showContext]);
  const deliveryPolicyDirty = deliveryPolicy
    ? deliverySources.join(',') !== deliveryPolicy.sources.join(',')
    : false;
  return (
    <SettingSection id="daily-report" title="日报集成" description="令牌允许读取当前账号的日程与 QQ 未读摘要，以及上传日报媒体、发布日报。不能修改日程，也不会返回邮箱授权码、附件、密码或 API Key。">
      <SettingRow label="日报令牌">
        <div className="settings-status" role="status">
          <strong>{loadError || (dailyReportStatus?.active ? '已启用' : dailyReportStatus?.exists ? '已撤销' : dailyReportStatus ? '尚未生成' : '加载状态中…')}</strong>
          {dailyReportStatus?.prefix && <span>令牌前缀：{dailyReportStatus.prefix}…</span>}
          {dailyReportStatus?.lastUsedAt && <span>最近使用：{new Date(dailyReportStatus.lastUsedAt).toLocaleString('zh-CN')}</span>}
          {loadError && <Button tag="button" variant="outline" onClick={loadDailyReportStatus}>重试令牌状态</Button>}
        </div>
        {dailyReportToken && <div className="settings-token-once"><strong>只显示一次</strong><span>关闭设置后无法再次查看明文，请立即保存。</span><code>{dailyReportToken}</code><div className="settings-actions"><Button tag="button" onClick={async () => { try { await navigator.clipboard.writeText(dailyReportToken); MessagePlugin.success('令牌已复制'); } catch { MessagePlugin.error('自动复制失败，请手动选择令牌'); } }}>复制令牌</Button></div></div>}
        <div className="settings-actions">
          <Button tag="button" loading={dailyReportBusy} disabled={!dailyReportStatus || !!loadError || dailyReportBusy} onClick={generateReportToken}>{dailyReportStatus?.active ? '轮换令牌' : '生成令牌'}</Button>
          {dailyReportStatus?.active && <Button tag="button" theme="danger" variant="outline" loading={dailyReportBusy} disabled={dailyReportBusy} onClick={revokeReportToken}>撤销令牌</Button>}
        </div>
      </SettingRow>
      <SettingRow label="来源接收与转发" description="只控制哪些已写入生产服务器的日报进入正式网页和邮件；不会暂停本地或 Work Cloud 任务。保存后从下一次正式发布生效，不追溯发送。">
        <div className="settings-stack">
          {deliveryPolicyError && <div className="settings-status" role="alert"><strong className="settings-error-text">{deliveryPolicyError}</strong><Button tag="button" variant="outline" onClick={() => void loadDeliveryPolicy()}>重试来源设置</Button></div>}
          {!deliveryPolicy && !deliveryPolicyError && <p className="settings-help" role="status">加载来源接收设置中…</p>}
          <div className="settings-switches" aria-label="日报来源接收设置">
            <label>
              <Switch aria-label="接收并转发本地日报" aria-checked={deliverySources.includes('local')} value={deliverySources.includes('local')} disabled={!deliveryPolicy || deliveryPolicyBusy} onChange={value => toggleDeliverySource('local', Boolean(value))} />
              <span>接收并转发本地日报</span>
            </label>
            <label>
              <Switch aria-label="接收并转发 Cloud 日报" aria-checked={deliverySources.includes('cloud')} value={deliverySources.includes('cloud')} disabled={!deliveryPolicy || deliveryPolicyBusy} onChange={value => toggleDeliverySource('cloud', Boolean(value))} />
              <span>接收并转发 Cloud 日报</span>
            </label>
          </div>
          <div className="settings-actions">
            <Button tag="button" loading={deliveryPolicyBusy} disabled={!deliveryPolicy || !deliveryPolicyDirty || deliveryPolicyBusy} onClick={() => void saveDeliveryPolicy()}>保存来源设置</Button>
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
      {showContext && <SettingRow id="setting-daily-report-17lgo36" label="日报个性化" description="编辑阅读偏好、近期关注、Watchlist 与 Cloud 研究框架。">
        <div className="settings-stack">
          <div className="settings-status" role="status">
            {cloudContextError && <strong className="settings-error-text">{cloudContextError}</strong>}
            {!cloudContextError && !cloudContext && <strong>加载状态中…</strong>}
            {!cloudContextError && cloudContext && <>
              <strong>{cloudContext.readFailed ? '资料读取异常，请先恢复' : cloudContext.version > 0 ? `已保存版本 v${cloudContext.version}` : '尚未配置'}</strong>
              {cloudContext.updatedAt && <span>最近保存：{new Date(cloudContext.updatedAt).toLocaleString('zh-CN')}</span>}
            </>}
          </div>
          <div className="settings-actions">
            <Button tag="button" onClick={onOpenPreferences}>编辑日报个性化</Button>
            <Button tag="button" variant="outline" loading={!cloudContext && !cloudContextError} onClick={() => void loadCloudContext()}>刷新保存状态</Button>
          </div>
          <p className="settings-note">个人资料从账号入口单独编辑；当前仅用于 Cloud 日报。保存不触发生成，不自动同步本地日报或其他环境。</p>
        </div>
      </SettingRow>}
    </SettingSection>
  );
}
