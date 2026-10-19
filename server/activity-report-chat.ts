import { queryOne } from './database/connection.js';
import type { ActivityReport } from './activity-reports.js';
import { safeOrbitLink } from '../src/utils/orbit-links.js';

const prose = (text: string) => text.replace(/[\\`*_{}\[\]()<>#+.!|~-]/g, '\\$&');
/** Rebuild known system report prose from its owned snapshot, never rewrite stored chat. */
export function activityReportChatText(userId: string, reportId: string): string {
  const row = queryOne<{ snapshot: string; insights: string | null }>('SELECT snapshot,insights FROM orbit_activity_reports WHERE user_id=? AND id=?', [userId, reportId]);
  if (!row) return '个人活动报告已移除或无法访问。';
  const snapshot = JSON.parse(row.snapshot) as ActivityReport['snapshot'], a = snapshot.activity;
  const items = (rows: Array<{title:string;date:string;href:string|null}>, empty: string) => rows.slice(0, 8).map(item => {
    const href = item.href && safeOrbitLink(item.href, 'https://orbit.invalid');
    return `- ${href ? `[${prose(item.title)}](${href})` : prose(item.title)} · ${prose(item.date || '日期未记录')}`;
  }).join('\n') || empty;
  const insights = (row.insights ? JSON.parse(row.insights) : []) as ActivityReport['insights'];
  return `## 个人活动报告\n${snapshot.window.start} 至 ${snapshot.window.end} · ${snapshot.window.timezone}\n\n完成 ${a.actualCompleted} 项 · 新增 ${a.created} 项 · 记事新增 ${a.notesAdded} 条\n当前积压 ${a.backlog} 项，逾期 ${a.overdue} 项；知识新增 ${snapshot.knowledge.added} 条。\n\n### 主要推进\n${items(a.metricDetails.completed, '本期没有有效完成记录。')}\n\n### 积压与逾期\n${items([...a.metricDetails.overdue, ...a.metricDetails.backlog], '当前没有积压或逾期事项。')}\n\n### AI 协作\n确认执行 ${a.aiConfirmed ?? '未记录'} 项，提醒卡片完成 ${a.reminderCompleted} 项，有效工具协助 ${a.toolUses} 次。\n\n${insights.length ? '### 本期洞察\n' + insights.map(i => '- ' + prose(i.text)).join('\n') : 'AI 洞察尚未生成或暂时不可用。'}\n\n### 下一周期到期事项\n${items(a.upcoming, '当前没有已安排的到期事项。')}\n\n[查看完整报告](/project?view=statistics&report=${encodeURIComponent(reportId)})`;
}
