import test from 'node:test';
import assert from 'node:assert/strict';
import { endOfMonth, endOfWeek, isWithinInterval, startOfMonth, startOfWeek } from 'date-fns';

test('explicit calendar date dependency retains local month/week and interval boundaries', () => {
  const date = new Date(2026, 9, 17, 13, 20);
  const start = startOfMonth(date), end = endOfMonth(date);
  assert.deepEqual([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()], [2026, 9, 1, 0]);
  assert.deepEqual([end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()], [31, 23, 59, 59, 999]);
  assert.equal(startOfWeek(date, { weekStartsOn: 1 }).getDate(), 12);
  assert.equal(endOfWeek(date, { weekStartsOn: 1 }).getDate(), 18);
  assert.equal(isWithinInterval(start, { start, end }), true);
  assert.equal(isWithinInterval(end, { start, end }), true);
  assert.equal(isWithinInterval(new Date(2026, 10, 1), { start, end }), false);
  assert.equal(date.getDate(), 17, 'date functions must not mutate the selected date');
});
