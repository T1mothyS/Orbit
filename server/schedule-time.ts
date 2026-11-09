/** Shared by normal writes; legacy backup restoration deliberately bypasses this check. */
export function scheduleDateInTimezone(value: string, timezone: string, allDay: boolean): string {
  if (allDay || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return value.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type)?.value).join('-');
}

export function validateScheduleTime(value: { type?: string; is_unscheduled?: boolean; all_day?: boolean; start_time?: string; end_time?: string }): void {
  if (value.is_unscheduled) {
    if (value.type !== 'todo' || value.all_day) throw new Error('无固定期限仅适用于非全天待办');
    return;
  }
  const start = value.start_time || '';
  validateDateTime(start, Boolean(value.all_day), '开始');
  // 待办没有持续时长，结束字段在所有正常写入入口统一丢弃。
  const end = value.type === 'todo' ? undefined : value.end_time;
  if (end) {
    validateDateTime(end, Boolean(value.all_day), '结束');
    if (!value.all_day && /(?:Z|[+-]\d{2}:\d{2})$/.test(start) !== /(?:Z|[+-]\d{2}:\d{2})$/.test(end)) {
      throw new Error('开始和结束时间必须使用一致的时区格式');
    }
    const reversed = value.all_day
      ? end.slice(0, 10) < start.slice(0, 10)
      : Date.parse(end) < Date.parse(start);
    if (reversed) throw new Error('结束时间不能早于开始时间');
  }
}

function validateDateTime(value: string, allDay: boolean, label: string): void {
  const format = allDay
    ? /^\d{4}-\d{2}-\d{2}(?:T00:00(?::00(?:\.000)?)?)?$/
    : /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/;
  if (typeof value !== 'string' || value.length > 64 || !format.test(value)) {
    throw new Error(allDay ? '全天事项必须使用日期或当天零点；请明确选择全天或定时' : `${label}时间格式不正确，请明确日期、时间及全天状态`);
  }
  const date = new Date(value.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${allDay ? '全天' : label}日期不正确`);
  }
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export function timePartsInTimezone(date: Date, timezone: string): LocalDateTimeParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    millisecond: date.getUTCMilliseconds(),
  };
}

function timezoneOffsetMs(date: Date, timezone: string): number {
  const parts = timePartsInTimezone(date, timezone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  return localAsUtc - date.getTime();
}

/**
 * 解析日程保存的开始时间。表单产生的是不带偏移量的用户本地时间，AI/导入数据也可能带 Z 或显式偏移量。
 */
export function parseScheduleStart(value: string, timezone: string): Date | null {
  const input = String(value || '').trim();
  if (!input) return null;

  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(input)) {
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(input);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0', millisecond = '0'] = match;
  const wallTimeMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    Number(millisecond.padEnd(3, '0')),
  );
  if (Number.isNaN(wallTimeMs)) return null;
  const wallTime = new Date(wallTimeMs);
  if (
    wallTime.getUTCFullYear() !== Number(year)
    || wallTime.getUTCMonth() !== Number(month) - 1
    || wallTime.getUTCDate() !== Number(day)
    || wallTime.getUTCHours() !== Number(hour)
    || wallTime.getUTCMinutes() !== Number(minute)
    || wallTime.getUTCSeconds() !== Number(second)
    || wallTime.getUTCMilliseconds() !== Number(millisecond.padEnd(3, '0'))
  ) return null;

  let candidate = new Date(wallTimeMs);
  try {
    // Recalculate once after applying the offset so DST transitions use the offset at the target instant.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const adjusted = new Date(wallTimeMs - timezoneOffsetMs(candidate, timezone));
      if (adjusted.getTime() === candidate.getTime()) return adjusted;
      candidate = adjusted;
    }
    return candidate;
  } catch {
    return null;
  }
}
