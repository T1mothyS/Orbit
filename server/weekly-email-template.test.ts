import assert from 'node:assert/strict';
import test from 'node:test';

import { renderWeeklyActivityEmail, type WeeklyEmailInput } from './weekly-email-template.js';

const input: WeeklyEmailInput = {
  from: '2026-11-08T12:00:00Z', to: '2026-11-15T12:00:00Z', asOf: '2026-11-15T12:00:01Z',
  timezone: 'Asia/Shanghai', reportPath: '/project?view=statistics&report=internal-id',
  counts: { created: 9, completed: 8, overdue: 0, backlog: 2, aging: 2, rescheduled: 1, confirmed: 9, assisted: 3, tools: 0 },
  completed: [{ title: '完成 <事项>', date: '2026-11-15T06:33:29Z', href: '/schedule?schedule=private-id' }],
  created: [{ title: '同一事项', date: '2026-11-14', href: '/schedule?schedule=private-id' }],
  rescheduled: [], overdue: [],
  backlog: [{ title: '无日期事项', date: '2026-10-06T01:36:15Z', href: '//example.org/injection' }],
  upcoming: [{ title: '全天安排', date: '2026-11-16T00:00:00', allDay: true }],
};

test('周报用历史快照口径和账号时区渲染，隐藏无值字段与已知内部标识', () => {
  const result = renderWeeklyActivityEmail(input, 'https://orbit.example.invalid');
  assert.match(result.text, /新增 9 项 · 完成 8 项/);
  assert.match(result.text, /11月15日.*14:33/);
  assert.match(result.text, /11月16日.*全天/);
  assert.match(result.text, /无固定期限 2 项，其中 2 项已积压至少 7 天/);
  assert.doesNotMatch(result.text, /同一事项|未完成|aging|2026-11|有效工具/);
  assert.match(result.html, /完成 &lt;事项&gt;/);
  assert.doesNotMatch(result.html, /example\.org|<事项>/);
  assert.match(result.html, />查看完整报告<\/a>/);
  assert.doesNotMatch(result.html, />https:\/\//);
});

test('新报告分开显示未完成、逾期和无日期事项', () => {
  const result = renderWeeklyActivityEmail({
    ...input,
    counts: { ...input.counts, open: 6, overdue: 2 },
    overdue: [{ title: '逾期待办', date: '2026-11-12T18:00:00' }],
  }, 'https://orbit.example.invalid');
  assert.match(result.text, /未完成 6 项 · 逾期 2 项/);
  assert.match(result.text, /已逾期 · 逾期待办 · 11月12日.*18:00/);
});
