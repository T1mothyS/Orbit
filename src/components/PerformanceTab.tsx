import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, EmptyState, InlineNotice, LoadingState, Select, Switch } from '../ui';
import { useAuth } from '../hooks/useAuth';
import { browserSamplingEnabled, setBrowserSampling, submitBrowserSnapshot } from '../utils/browser-performance';

interface PerformanceView {
  enabled: boolean;
  observedAt: number;
  writeFailed: boolean;
  lastSavedAt: number | null;
  routes: Array<{ route: string; count: number; errors: number; p50: number | null; p95: number | null; p99: number | null }>;
  trend: Array<{ at: number; count: number; errors: number }>;
  traces: Array<{ id: string; route: string; status: number; observedAt: number; durationMs: number; phases?: Record<string, number> }>;
  browser: Array<{ requestId?: string; observedAt: number; navigationMs?: number; dnsMs?: number; connectMs?: number; tlsMs?: number;
    ttfbMs?: number; requestMs?: number; longTaskMs?: number; interactionMs?: number }>;
  host: { observedAt?: string; memoryBytes?: { MemAvailable?: number; MemTotal?: number };
    paging?: { swapInBytes?: number; swapOutBytes?: number };
    cpu?: { busyPercent?: number; ioWaitPercent?: number };
    filesystem?: { availableBytes?: number }; disk?: { writesPerSecond?: number; meanWriteMs?: number } } | null;
  process?: { uptimeSeconds: number; rssBytes: number };
  loop: { p95Ms: number; utilizationPercent: number } | null;
}

const ranges = [{ label: '最近 5 分钟', value: '5m' }, { label: '最近 1 小时', value: '1h' },
  { label: '最近 24 小时', value: '24h' }, { label: '最近 30 天', value: '30d' }];
const phaseNames: Record<string,string> = { sqlMs: 'SQL', exportMs: '数据库导出', writeMs: '写文件', syncMs: '磁盘同步' };
const timeText = (value: number) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const ms = (value?: number | null) => typeof value === 'number' ? `${value} ms` : '未采到';
const pct = (value?: number | null) => typeof value === 'number' ? `${value}%` : '未采到';
const mib = (value?: number) => typeof value === 'number' ? `${Math.round(value / 1024**2)} MiB` : '未采到';

export function PerformanceTab() {
  const { authHeaders } = useAuth();
  const auth = useRef(authHeaders);
  auth.current = authHeaders;
  const [range, setRange] = useState('1h');
  const [snapshot, setSnapshot] = useState<PerformanceView | null>(null);
  const [enabled, setEnabled] = useState(browserSamplingEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState('');
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true);
    try {
      const result = await fetch('/api/system/performance?range=' + range, {
        headers: auth.current(), signal: controller.signal, cache: 'no-store',
      });
      if (!result.ok) throw new Error(result.status === 403 ? '此账号无权查看性能数据' : '性能数据读取失败');
      const data = await result.json();
      if (!controller.signal.aborted) {
        setSnapshot(data);
        setError('');
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '性能数据暂不可用');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [range]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30000);
    return () => { window.clearInterval(timer); activeRequest.current?.abort(); };
  }, [refresh]);

  const currentTrace = snapshot?.traces.find(item => item.id === selected);
  const browser = currentTrace
    ? snapshot?.browser.find(item => item.requestId === currentTrace.id)
    : snapshot?.browser[0];
  const host = snapshot?.host;
  const setSampling = (checked: boolean) => {
    setBrowserSampling(checked);
    setEnabled(browserSamplingEnabled());
    if (checked) submitBrowserSnapshot(auth.current());
  };

  return <div className="admin-performance">
    <div className="admin-toolbar">
      <Select label="统计范围" value={range} options={ranges} onValueChange={value => setRange(value || '1h')} />
      <Button leadingIcon={<RefreshCw size={16} />} onClick={() => void refresh()} disabled={busy}>刷新</Button>
      <label className="admin-auto-refresh"><Switch label="采集此浏览器的性能" checked={enabled} onCheckedChange={setSampling} /><span>采集此浏览器的性能</span></label>
    </div>
    {error && <InlineNotice tone="danger" title={error} />}
    {!snapshot && busy && <LoadingState label="正在读取性能数据…" />}
    {snapshot && !snapshot.enabled && <EmptyState title="性能采样尚未开启" description="启用服务端监控后，这里会显示收到的记录。" />}
    {snapshot?.enabled && <>
      {snapshot.writeFailed && <InlineNotice tone="warning" title="趋势暂未保存">当前窗口仍可查看，重启后可能缺失。</InlineNotice>}
      <div className="admin-performance-pairs">
        <section>
          <h3>主机与服务</h3>
          <dl>
            <dt>CPU 使用</dt><dd>{pct(host?.cpu?.busyPercent)}</dd>
            <dt>内存可用</dt><dd>{mib(host?.memoryBytes?.MemAvailable)}</dd>
            <dt>磁盘可用</dt><dd>{mib(host?.filesystem?.availableBytes)}</dd>
            <dt>Swap 换入/换出</dt><dd>{mib(host?.paging?.swapInBytes)} / {mib(host?.paging?.swapOutBytes)}</dd>
            <dt>磁盘平均写入延迟</dt><dd>{ms(host?.disk?.meanWriteMs)}</dd>
            <dt>事件循环 P95</dt><dd>{ms(snapshot.loop?.p95Ms)}</dd>
            <dt>进程内存</dt><dd>{mib(snapshot.process?.rssBytes)}</dd>
            <dt>进程已运行</dt><dd>{snapshot.process ? `${Math.floor(snapshot.process.uptimeSeconds / 60)} 分钟` : '未采到'}</dd>
          </dl>
        </section>
        <section>
          <h3>浏览器与网络</h3>
          {!browser ? <p className="oui-help">等待此浏览器完成加载或提交一次事项。</p> : <dl>
            <dt>页面加载</dt><dd>{ms(browser.navigationMs)}</dd>
            <dt>DNS / 建连 / TLS</dt><dd>{ms(browser.dnsMs)} / {ms(browser.connectMs)} / {ms(browser.tlsMs)}</dd>
            <dt>首字节等待</dt><dd>{ms(browser.ttfbMs)}</dd>
            <dt>请求响应</dt><dd>{ms(browser.requestMs)}</dd>
            <dt>长任务 / 交互样本</dt><dd>{ms(browser.longTaskMs)} / {ms(browser.interactionMs)}</dd>
          </dl>}
        </section>
      </div>
      <section>
        <h3>关键接口</h3>
        {!snapshot.routes.length ? <p className="oui-help">此时段还没有关键操作样本。</p> : <>
          <p className="oui-help">耗时按区间上限估算。样本量较少时，结合具体请求查看。</p>
          <div className="admin-performance-table" tabIndex={0} aria-label="接口统计，可横向滚动">
            <table><thead><tr><th scope="col">接口</th><th scope="col">请求</th><th scope="col">5xx</th><th scope="col">P50</th><th scope="col">P95</th><th scope="col">P99</th></tr></thead>
            <tbody>{snapshot.routes.map(row => <tr key={row.route}><th scope="row">{row.route}</th><td>{row.count}</td><td>{row.errors}</td><td>{ms(row.p50)}</td><td>{ms(row.p95)}</td><td>{ms(row.p99)}</td></tr>)}</tbody></table>
          </div>
        </>}
      </section>
      {!!snapshot.traces.length && <section>
        <h3>请求明细</h3>
        <Select label="按请求编号查找" value={selected} options={[{ value: '', label: '选择一个请求' }, ...snapshot.traces.map(item => ({
          value: item.id, label: `${timeText(item.observedAt)} · ${item.route} · ${item.durationMs} ms · ${item.id.slice(0,8)}`,
        }))]} onValueChange={value => setSelected(value || '')} />
        {currentTrace && <dl>
          <dt>请求 ID</dt><dd>{currentTrace.id}</dd>
          <dt>状态 / 总耗时</dt><dd>{currentTrace.status} / {ms(currentTrace.durationMs)}</dd>
          {Object.entries(currentTrace.phases || {}).map(([phase, value]) => <Fragment key={phase}><dt>{phaseNames[phase] || phase}</dt><dd>{ms(value)}</dd></Fragment>)}
        </dl>}
      </section>}
      {!!snapshot.trend.length && <details className="admin-performance-trend">
        <summary>分时请求与错误趋势</summary>
        <div className="admin-performance-table"><table><thead><tr><th scope="col">时间</th><th scope="col">请求</th><th scope="col">5xx</th></tr></thead>
          <tbody>{snapshot.trend.map(row => <tr key={row.at}><th scope="row">{timeText(row.at)}</th><td>{row.count}</td><td>{row.errors}</td></tr>)}</tbody></table></div>
      </details>}
    </>}
  </div>;
}
