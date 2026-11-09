import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Circle, CircleCheck, Cloud, CloudLightning, CloudRain, CloudSnow, CloudSun } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { ChatMarkdown } from './ChatMarkdown';
import { useAuth } from '../hooks/useAuth';
import type { DailyActionItem, DailyActionMeta, DailyActionSnapshot } from '../utils/daily-action';

function clock(value: string | undefined, timezone: string) {
  if (!value) return '';
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return value.slice(11, 16);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleTimeString('zh-CN', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
}
export function DailyActionCard({ action, legacyText, pushedAt, onOpen, onRefresh }: {
  action: DailyActionMeta; legacyText?: string; pushedAt?: string; onOpen?: (id: string, edit?: boolean) => void; onRefresh?: () => void;
}) {
  const { authHeaders } = useAuth();
  const navigate = useNavigate();
  const [latest, setLatest] = useState<DailyActionSnapshot | null>(null);
  const [completedOverrides, setCompletedOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setCompletedOverrides(previous => Object.fromEntries(Object.entries(previous).filter(([id, completed]) =>
      !(action.items || []).some(item => item.id === id && item.current?.completed === completed))));
  }, [action.items]);
  useEffect(() => {
    setCompletedOverrides(previous => Object.fromEntries(Object.entries(previous).filter(([id, completed]) =>
      !(latest?.items || []).some(item => item.id === id && item.current?.completed === completed))));
  }, [latest?.items]);
  const [mode, setMode] = useState<'snapshot' | 'latest'>('snapshot');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState('');
  const request = useRef<AbortController | null>(null), updating = useRef(false);
  const requestedMode = useRef<'snapshot' | 'latest'>('snapshot');
  useEffect(() => () => request.current?.abort(), []);
  const timezone = latest && mode === 'latest' ? latest.timezone : action.timezone || 'Asia/Shanghai';
  const items = (mode === 'latest' ? latest?.items || [] : action.items || []).map(item => completedOverrides[item.id] === undefined || !item.current ? item : { ...item, current: { ...item.current, completed: completedOverrides[item.id] } });
  const shownDate = mode === 'latest' ? latest?.date || action.date : action.date;
  const weather = action.weather;
  async function loadLatest(activate = true) {
    if (activate) requestedMode.current = 'latest';
    if (requestedMode.current !== 'latest') return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/action-center/daily-action?date=today', { headers: authHeaders(), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '今日事项读取失败');
      if (!controller.signal.aborted && requestedMode.current === 'latest') { setLatest(data); setMode('latest'); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '今日事项读取失败'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  useEffect(() => {
    if (mode !== 'latest') return;
    const refresh = () => { void loadLatest(false); };
    window.addEventListener('orbit:data-change', refresh);
    return () => window.removeEventListener('orbit:data-change', refresh);
  }, [mode, authHeaders]);
  async function complete(item: DailyActionItem) {
    const scheduleId = item.current?.scheduleId;
    const recurring = item.sourceType === 'reminder';
    if (updating.current || !item.current?.available || (recurring ? !item.current.editable || item.current.completed || !item.instanceId : !scheduleId)) return;
    const completed = !item.current.completed;
    updating.current = true; setBusy(item.id); setError('');
    try {
      const response = await fetch(recurring ? `/api/cycle-reminders/${encodeURIComponent(item.sourceId)}/complete` : `/api/schedules/${encodeURIComponent(scheduleId!)}/toggle`, {
        method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(recurring ? { cycleId: item.instanceId } : { completed }), signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '事项更新失败');
      setCompletedOverrides(previous => ({ ...previous, [item.id]: completed }));
      window.dispatchEvent(new Event('orbit:data-change'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '事项更新失败'); }
    finally { onRefresh?.(); updating.current = false; setBusy(null); }
  }
  function open(item: DailyActionItem) {
    if (!item.current?.available) return;
    if (item.current.editable && item.current.scheduleId && onOpen) onOpen(item.current.scheduleId, true);
    else if (item.current.href) navigate(item.current.href);
  }
  const WeatherIcon = weather.state !== 'available' ? Cloud : weather.code >= 95 ? CloudLightning
    : [71, 73, 75, 77, 85, 86].includes(weather.code) ? CloudSnow : weather.code >= 51 ? CloudRain : CloudSun;
  return <section className="orbit-daily-action" aria-label="今日行动提醒" aria-busy={loading}>
    <header className="orbit-daily-paper"><div className="orbit-daily-date"><time dateTime={shownDate}>{shownDate}</time><span>{mode === 'snapshot' ? '推送时快照' : '今日最新'}</span></div><h2>今日行动提醒</h2>
      {mode === 'snapshot' && action.legacy ? <p>早期提醒记录</p> : <p><strong>{items.filter(item => !item.completed).length}</strong> 项待处理</p>}
      {mode === 'snapshot' && <div className="orbit-daily-weather"><WeatherIcon size={23} aria-hidden="true" />{weather.state === 'available' ? <><span>{[weather.place, weather.description].filter(Boolean).join(' · ')}</span><div>{weather.low != null && weather.high != null && <strong>{Math.round(weather.low)}–{Math.round(weather.high)}°C</strong>}{weather.rain != null && <small>降雨 {Math.round(weather.rain)}%</small>}{weather.cached && <small>缓存预报</small>}</div></> : <span>{weather.state === 'unavailable' ? `${weather.place} · 天气暂不可用` : '尚未设置天气地点'}</span>}</div>}
    </header>
    <div className="orbit-daily-body">{(['todo', 'event', 'reminder'] as const).map(type => {
      const group = items.filter(item => item.type === type); if (!group.length) return null;
      const label = { todo: '待办', event: '日程', reminder: '周期事务' }[type];
      return <section className="orbit-daily-list" aria-label={label} key={type}><div className="orbit-daily-list-heading"><h3>{label} <span>{group.length}</span></h3></div><ul>{group.map(item => <li className="orbit-daily-task" key={item.id}>
        <time dateTime={item.startTime}>{item.allDay ? '全天' : clock(item.startTime, timezone)}</time>
        <IconButton label={`${item.current?.completed ? (type === 'reminder' ? '已完成周期事务' : `恢复${label}`) : `完成${label}`}：${item.title}`} variant="quiet" className="orbit-daily-complete" aria-pressed={!!item.current?.completed} loading={busy === item.id} disabled={!!busy || !item.current?.available || (type === 'reminder' ? !item.current.editable || item.current.completed || !item.instanceId : !item.current.scheduleId)} onClick={() => void complete(item)}><span className="orbit-daily-completion-ring">{item.current?.completed ? <CircleCheck size={20} aria-hidden="true" /> : <Circle size={20} aria-hidden="true" />}</span></IconButton>
        <Button variant="quiet" className="orbit-daily-item" disabled={!item.current?.available} onClick={() => open(item)}><strong>{item.title}</strong>{item.dueDate && type === 'reminder' && <small>{item.dueDate} 到期</small>}{!item.current?.available ? <small>原事项已移除或不可用</small> : item.current.completed && <small>当前已完成</small>}</Button>
      </li>)}</ul></section>;
    })}
      {items.length === 0 && <p className="orbit-card-empty">{mode === 'snapshot' && action.legacy ? '这条早期提醒未保存完整快照，可查看今日最新事项。' : mode === 'snapshot' ? '推送时没有待处理事项' : '今天的事项都处理好了'}</p>}
      {mode === 'snapshot' && action.legacy && legacyText && <details className="orbit-daily-original"><summary>原提醒文本</summary><ChatMarkdown text={legacyText} /></details>}
      {error && <p className="orbit-inline-error" role="alert">{error}</p>}
    </div><footer className="orbit-daily-footer"><span>{mode === 'snapshot' ? `推送于 ${clock(action.capturedAt || pushedAt, timezone) || '当日'}` : `更新于 ${clock(latest?.capturedAt, timezone)}`}</span><Button variant="link" loading={loading && mode === 'snapshot'} onClick={() => { if (mode === 'latest') { requestedMode.current = 'snapshot'; request.current?.abort(); setLoading(false); setMode('snapshot'); setError(''); } else void loadLatest(); }}>
      {mode === 'latest' ? <><ArrowLeft size={16} aria-hidden="true" />返回今日快照</> : <>查看今日最新<ArrowRight size={16} aria-hidden="true" /></>}
    </Button></footer>
  </section>;
}
