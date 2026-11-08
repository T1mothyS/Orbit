import { useState } from 'react';
import { Button, Select, Textarea } from '../../../ui';
import { SettingRow } from '../SettingFields';

const testTypes = [
  { value: 'exact', label: '本地精确测试' },
  { value: 'inexact', label: '本地非精确测试' },
  { value: 'fcm', label: '谷歌推送测试' },
];
interface Observation {
  kind: string;
  time: number;
  received: boolean;
}
const maxRecords = 10;
function readRecords(key: string): Observation[] {
  try {
    const entries: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(entries)) return entries.filter((entry): entry is Observation =>
      entry && testTypes.some(type => type.value === entry.kind) &&
      Number.isFinite(entry.time) && typeof entry.received === 'boolean'
    ).slice(0, maxRecords);
  } catch { /* Unavailable storage or old malformed values. */ }
  return [];
}
function describe(entry: Observation) {
  const label = testTypes.find(type => type.value === entry.kind)?.label;
  return `${new Date(entry.time).toLocaleString()} · ${label} · ${entry.received ? '已收到' : '未收到'}`;
}
export function AndroidNotificationRecords({ accountId, summary }: { accountId: string; summary: string[] }) {
  const storageKey = `orbit.android-notification-observations.${accountId}`;
  const [records, setRecords] = useState(() => readRecords(storageKey));
  const [kind, setKind] = useState<string | null>('exact');
  const [feedback, setFeedback] = useState('');
  const [showReport, setShowReport] = useState(false);
  const report = ['Orbit 通知诊断', ...summary, '实机观察', ...records.map(describe)].join('\n');

  const save = (received: boolean) => {
    if (!kind) return;
    const next = [{ kind, time: Date.now(), received }, ...records].slice(0, maxRecords);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setRecords(next);
      setFeedback('已记录本次实机结果。');
    } catch {
      setFeedback('当前设备无法保存记录。');
    }
  };
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setFeedback('已复制诊断报告。');
    } catch {
      setShowReport(true);
      setFeedback('无法自动复制，可手动选取报告文本。');
    }
  };

  return <SettingRow label="实机记录" description="查看系统通知栏后记录结果。最近 10 条保存在这台手机的当前账号下。">
    <div className="settings-stack">
      <Select label="记录测试类型" value={kind} onValueChange={setKind} options={testTypes} />
      <div className="settings-actions">
        <Button variant="secondary" disabled={!kind} onClick={() => save(true)}>记录已收到</Button>
        <Button variant="secondary" disabled={!kind} onClick={() => save(false)}>记录未收到</Button>
        <Button variant="secondary" onClick={() => void copyReport()}>复制脱敏报告</Button>
      </div>
      {feedback && <p className="settings-help" role="status">{feedback}</p>}
      {showReport && <Textarea aria-label="脱敏诊断报告" value={report} readOnly rows={5} />}
      {records.length > 0 && <details>
        <summary>查看最近记录（{records.length}）</summary>
        <ul className="settings-help">{records.map((entry, index) => <li key={`${entry.time}-${index}`}>{describe(entry)}</li>)}</ul>
      </details>}
    </div>
  </SettingRow>;
}
