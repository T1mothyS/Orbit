import { isValidDateKey } from './date-key.js';

export function dateInZone(now: Date, timezone = 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-');
}
export function addDateDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function resolveQueryDates(text: string, anchor: string): string[] {
  if (!isValidDateKey(anchor)) throw new Error('查询基准日期无效');
  const dates = new Set<string>();
  const add = (date: string) => { if (!isValidDateKey(date))throw new Error('查询日期无效，请核对年月日'); dates.add(date); };
  const now = new Date(`${anchor}T12:00:00Z`);
  const weekday = now.getUTCDay() || 7;
  let rest = text.toLowerCase();
  rest = rest.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (_, y, m, d) => { add(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`); return ' '; });
  rest = rest.replace(/(?:(\d{4})年)?(\d{1,2})[月/-](\d{1,2})[日号]?/g, (_, y, m, d) => { add(`${y || anchor.slice(0, 4)}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`); return ' '; });
  rest = rest.replace(/(上|下|本|这)?(?:周|星期)([一二三四五六日天])/g, (_, which, day) => {
    const index = '一二三四五六日'.indexOf(day === '天' ? '日' : day) + 1;
    add(addDateDays(anchor, index - weekday + (which === '下' ? 7 : which === '上' ? -7 : 0)));
    return ' ';
  });
  rest = rest.replace(/大后天|后天|明天|明日|tomorrow|大前天|前天|昨天|昨日|yesterday|今天|今日|本日|today/g, word => {
    const offset = /大后天/.test(word) ? 3 : /后天/.test(word) ? 2 : /明天|明日|tomorrow/.test(word) ? 1 : /大前天/.test(word) ? -3 : /前天/.test(word) ? -2 : /昨天|昨日|yesterday/.test(word) ? -1 : 0;
    add(addDateDays(anchor, offset)); return ' ';
  });
  rest = rest.replace(/(\d{1,3}|[一二两三四五六七八九十])天(后|前)/g, (_, n, direction) => {
    const count = /^\d+$/.test(n) ? Number(n) : ({一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10} as Record<string,number>)[n];
    if (count <= 365) add(addDateDays(anchor, count * (direction === '前' ? -1 : 1))); return ' ';
  });
  if(/周末/.test(rest)){const shift=/下周末/.test(rest)?7:/上周末/.test(rest)?-7:0;add(addDateDays(anchor,6-weekday+shift));add(addDateDays(anchor,7-weekday+shift));rest=rest.replace(/(?:下|上|本|这)?周末/g,' ');}
  const week = /(下周|下星期|next week|上周|上星期|last week|本周|这周|this week)/.exec(rest)?.[0];
  if (week) {
    const shift = /下|next/.test(week) ? 7 : /上|last/.test(week) ? -7 : 0;
    for (let i = 0; i < 7; i++) add(addDateDays(anchor, 1 - weekday + shift + i));
  }
  if (/本月|这月|下月|上月/.test(rest)) {
    const shift = /下月/.test(rest) ? 1 : /上月/.test(rest) ? -1 : 0;
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + shift, 1, 12));
    const end = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    for (let i = 1; i <= end; i++) add(`${first.toISOString().slice(0, 8)}${String(i).padStart(2, '0')}`);
  }
  return dates.size ? [...dates].sort() : [anchor];
}

export function statisticsPeriod(period: string, anchor: string): { start: string; end: string } {
  if (!isValidDateKey(anchor) || !['week', 'month', 'year'].includes(period)) throw new Error('统计日期或周期无效');
  const value = new Date(`${anchor}T12:00:00Z`);
  if (period === 'week') { const start = addDateDays(anchor, 1 - (value.getUTCDay() || 7)); return { start, end: addDateDays(start, 6) }; }
  if (period === 'year') return { start: `${anchor.slice(0,4)}-01-01`, end: `${anchor.slice(0,4)}-12-31` };
  return { start: `${anchor.slice(0,7)}-01`, end: `${anchor.slice(0,7)}-${new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0)).getUTCDate()}` };
}
