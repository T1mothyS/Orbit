import { useState } from 'react';
import { ArrowRight, CheckCheck, ListPlus, NotebookPen, Check, CalendarDays } from 'lucide-react';
import { Button, ButtonLink, TextLink } from '../ui';
import type { ActivityReportCardData, ActivityReportCardItem } from '../utils/activity-report-card';

function dateLabel(value: string, timezone: string) {
  if (!value) return '日期未记录';
  // Floating calendar dates are already local to the report, not browser time.
  const date = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? new Date(value) : new Date(value.slice(0, 10) + 'T12:00:00Z');
  return Number.isNaN(date.getTime()) ? '日期未记录' : date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', timeZone: /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? timezone : 'UTC' });
}
export function WeeklyActivityCard({ report }: { report: ActivityReportCardData }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? report.completedItems : report.completedItems.slice(0, 4);
  const groups = new Map<string, ActivityReportCardItem[]>();
  for (const item of visible) { const date = dateLabel(item.date, report.timezone); groups.set(date, [...(groups.get(date) || []), item]); }
  const renderItem = (item: ActivityReportCardItem, completed = false) => <li key={item.id}>
    {completed ? <Check size={16} aria-hidden="true" /> : <CalendarDays size={16} aria-hidden="true" />}
    <span>{item.href ? <TextLink to={item.href}>{item.title}</TextLink> : item.title}</span>
    {!completed && report.upcoming.includes(item) && <time>{dateLabel(item.date, report.timezone)}</time>}
  </li>;
  return <section className="orbit-weekly-card" aria-label="每周个人活动报告">
    <header><div className="orbit-weekly-kicker"><NotebookPen size={18} aria-hidden="true" /><span>Orbit Weekly</span><time>{dateLabel(report.start, report.timezone)} — {dateLabel(report.end, report.timezone)}</time></div><h2>本周回顾</h2><p>完成了 <strong>{report.completed}</strong> 件事，留下 <strong>{report.notes}</strong> 条记录。</p></header>
    <dl className="orbit-weekly-metrics">{[[CheckCheck, '完成', report.completed], [ListPlus, '新增', report.created], [NotebookPen, '记事', report.notes]].map(([Icon, label, value]) => { const MetricIcon = Icon as typeof Check; return <div key={String(label)}><dt><MetricIcon size={17} aria-hidden="true" />{String(label)}</dt><dd>{String(value)}</dd></div>; })}</dl>
    <div className="orbit-weekly-content"><section><h3>主要推进</h3>{groups.size ? [...groups].map(([date, items]) => <div className="orbit-weekly-day" key={date}><h4>{date}</h4><ul>{items.map(item => renderItem(item, true))}</ul></div>) : <p className="orbit-card-empty">本周还没有完成记录</p>}
      {report.completedItems.length > 4 && <Button variant="link" onClick={() => setExpanded(!expanded)}>{expanded ? '收起' : `展开全部 ${report.completedItems.length} 项`}</Button>}
    </section>
    {report.insights.length > 0 && <section className="orbit-weekly-insights"><h3>本周洞察</h3>{report.insights.map((text, index) => <p key={index}>{text}</p>)}</section>}
    {(report.pendingItems.length > 0 || report.upcoming.length > 0) && <section><h3>接下来 <span>{report.overdue > 0 ? `${report.overdue} 项逾期` : `${report.backlog} 项待安排`}</span></h3><ul className="orbit-weekly-next">{[...report.pendingItems, ...report.upcoming].slice(0, 3).map(item => renderItem(item))}</ul></section>}
    </div><footer><ButtonLink variant="link" to={`/project?view=statistics&report=${encodeURIComponent(report.reportId)}`}>查看完整报告 <ArrowRight size={16} aria-hidden="true" /></ButtonLink></footer>
  </section>;
}
