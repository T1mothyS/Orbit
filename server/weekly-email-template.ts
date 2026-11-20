import type { ActivityReport } from './activity-reports.js';
import { escapeEmailHtml } from './daily-email-template.js';
import { parseScheduleStart } from './schedule-time.js';

type ReportItem = { title: string; date: string; href?: string | null; allDay?: boolean };

export interface WeeklyEmailInput {
  from: string;
  to: string;
  asOf: string;
  timezone: string;
  reportPath?: string;
  counts: {
    created: number;
    completed: number;
    open?: number;
    overdue: number;
    backlog: number;
    aging?: number | null;
    rescheduled?: number | null;
    confirmed?: number | null;
    assisted?: number;
    tools?: number;
  };
  completed: ReportItem[];
  created: ReportItem[];
  rescheduled: ReportItem[];
  overdue: ReportItem[];
  backlog: ReportItem[];
  upcoming: ReportItem[];
}

export function weeklyEmailInput(report: ActivityReport): WeeklyEmailInput {
  const { snapshot } = report;
  const activity = snapshot.activity;
  const details = activity.metricDetails;
  return {
    from: report.rangeStart, to: report.rangeEnd, asOf: snapshot.window.asOf, timezone: snapshot.window.timezone,
    reportPath: '/project?view=statistics&report=' + encodeURIComponent(report.id),
    counts: {
      created: activity.created, completed: activity.actualCompleted, open: activity.weekly?.open,
      overdue: activity.weekly?.overdue ?? activity.overdue, backlog: activity.backlog, aging: activity.aging,
      rescheduled: activity.rescheduled, confirmed: activity.aiConfirmed, assisted: activity.reminderCompleted, tools: activity.toolUses,
    },
    completed: details.completed ?? [], created: details.created ?? [], rescheduled: details.rescheduled ?? [],
    overdue: activity.weekly?.overdueDetails ?? [],
    backlog: details.backlog ?? [], upcoming: activity.weekly?.upcomingDetails ?? activity.upcoming ?? [],
  };
}

function reportLink(value: string | null | undefined, origin: string): string | null {
  if (!value?.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  const url = new URL(value, origin);
  return url.origin === origin && ['/project', '/schedule', '/reminders', '/assistant'].includes(url.pathname) ? url.href : null;
}

export function renderWeeklyActivityEmail(input: WeeklyEmailInput, appUrl: string): { subject: string; text: string; html: string } {
  const base = new URL(appUrl);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) throw new Error('周报链接需要有效站点地址');
  const origin = base.origin;
  const timezone = input.timezone;
  const dateText = (raw: string, allDay = false, showTime = true) => {
    const dateOnly = allDay || /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const date = dateOnly ? new Date(raw.slice(0, 10) + 'T12:00:00Z') : parseScheduleStart(raw, timezone);
    if (!date || !Number.isFinite(date.getTime())) return '时间待定';
    const localZone = dateOnly ? 'UTC' : timezone;
    const day = new Intl.DateTimeFormat('zh-CN', { timeZone: localZone, month: 'long', day: 'numeric', weekday: 'short' }).format(date);
    if (!showTime) return day;
    if (dateOnly) return day + (allDay ? ' 全天' : '');
    return day + ' ' + new Intl.DateTimeFormat('zh-CN', { timeZone: localZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  };

  const subject = 'Orbit Weekly · 个人每周回顾';
  const period = dateText(input.from) + ' 至 ' + dateText(input.to);
  const counts = input.counts;
  const headline = `新增 ${counts.created} 项 · 完成 ${counts.completed} 项`;
  const outstanding = [counts.open === undefined ? '' : `未完成 ${counts.open} 项`, `逾期 ${counts.overdue} 项`].filter(Boolean).join(' · ');
  const asOf = `截至 ${dateText(input.asOf)}，${outstanding}`;
  const keepUnique = (items: ReportItem[], limit: number) => {
    const links = new Set<string>();
    return items.filter(item => {
      const key = item.href || item.title + '\n' + item.date;
      if (links.has(key)) return false;
      links.add(key);
      return true;
    }).slice(0, limit);
  };
  const tagged = (items: ReportItem[], tag: string, limit: number) => keepUnique(items, limit).map(item => ({
    ...item, title: tag + ' · ' + item.title,
  }));
  const progress = keepUnique([
    ...tagged(input.completed, '已完成', 3),
    ...tagged(input.rescheduled, '已改期', 2),
    ...tagged(input.created, '新安排', 2),
  ], 5);
  const backlog = [
    counts.backlog ? `无固定期限 ${counts.backlog} 项` : '',
    counts.aging ? `其中 ${counts.aging} 项已积压至少 7 天` : '',
  ].filter(Boolean).join('，');
  const ai = [
    counts.confirmed ? `确认执行 ${counts.confirmed} 项` : '',
    counts.assisted ? `从提醒卡片完成 ${counts.assisted} 项` : '',
    counts.tools ? `有结果的工具协助 ${counts.tools} 次` : '',
  ].filter(Boolean).join(' · ');
  const sections = [
    { title: '重要进展', note: counts.rescheduled ? `有 ${counts.rescheduled} 项调整了安排` : '', items: progress },
    { title: '待处理事项', note: backlog, items: [
      ...tagged(input.overdue, '已逾期', 3),
      ...keepUnique(input.backlog, 2).map(item => ({ ...item, date: '' })),
    ] },
    { title: '下周安排', note: '', items: keepUnique(input.upcoming, 5) },
    { title: 'AI 协作', note: ai, items: [] },
  ].filter(section => section.note || section.items.length);
  const link = reportLink(input.reportPath, origin);
  const lines = sections.flatMap(section => [
    '', section.title, ...(section.note ? [section.note] : []), ...section.items.map(item =>
      '• ' + item.title + (item.date ? ' · ' + dateText(item.date, item.allDay) : '')),
  ]);
  const text = [subject, period, '', headline, asOf, ...lines, ...(link ? ['', '查看完整报告', link] : [])].join('\n');
  const html = `<!doctype html>
<html lang="zh-CN"><body style="margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
<tr><td style="padding:24px;text-align:left">
<h1 style="margin:0 0 8px;font-size:22px;line-height:1.35">Orbit Weekly · 个人每周回顾</h1>
<p style="margin:0;color:#475569;line-height:1.6">${escapeEmailHtml(period)}</p>
<div style="margin:18px 0 22px;padding:14px;background:#eff6ff;border-radius:8px;line-height:1.65">
<strong>${escapeEmailHtml(headline)}</strong><br>${escapeEmailHtml(asOf)}</div>
${sections.map(section => `<h2 style="margin:20px 0 8px;font-size:17px">${section.title}</h2>
${section.note ? `<p style="margin:0 0 8px;color:#475569;line-height:1.55">${escapeEmailHtml(section.note)}</p>` : ''}
${section.items.length ? `<ul style="margin:0;padding-left:20px;line-height:1.6">${section.items.map(item => {
  const href = reportLink(item.href, origin);
  const title = escapeEmailHtml(item.title);
  return `<li style="padding:2px 0;overflow-wrap:anywhere">${href ? `<a style="color:#1d4ed8" href="${escapeEmailHtml(href)}">${title}</a>` : title}${item.date ? ` <span style="color:#475569">· ${escapeEmailHtml(dateText(item.date, item.allDay))}</span>` : ''}</li>`;
}).join('')}</ul>` : ''}`).join('')}
${link ? `<a style="display:inline-block;margin-top:22px;background:#1d4ed8;color:#fff;padding:11px 15px;border-radius:8px;text-decoration:none" href="${escapeEmailHtml(link)}">查看完整报告</a>` : ''}
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}
