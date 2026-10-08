import assert from 'node:assert/strict';
import test from 'node:test';
import { linkedEndTime, shiftDateKey } from '../src/components/calendar/schedule-presentation.js';
import { validateScheduleTime } from './schedule-time.js';

test('confirmed start changes preserve later ends and move earlier ends one hour forward', () => {
  assert.deepEqual(linkedEndTime('2026-10-09','09:00','2026-10-09','10:00'), {endDate:'2026-10-09',endTime:'10:00'});
  assert.deepEqual(linkedEndTime('2026-10-09','11:00','2026-10-09','10:00'), {endDate:'2026-10-09',endTime:'12:00'});
  assert.deepEqual(linkedEndTime('2026-10-09','09:00','2026-10-11','08:00'), {endDate:'2026-10-11',endTime:'08:00'});
});

test('late-night linkage rolls into the next date and stays valid at month/year boundaries', () => {
  for (const [date,next] of [['2026-10-09','2026-10-10'],['2026-12-31','2027-01-01'],['2028-02-29','2028-03-01']]) {
    const end = linkedEndTime(date,'23:59',date,'10:00');
    assert.deepEqual(end,{endDate:next,endTime:'00:59'});
    assert.doesNotThrow(() => validateScheduleTime({type:'event',start_time:`${date}T23:59:00`,end_time:`${end.endDate}T${end.endTime}:00`}));
  }
});

test('date-only shifts retain multi-day offsets and tolerate cleared date drafts', () => {
  assert.equal(shiftDateKey('2026-12-31',2),'2027-01-02');
  assert.equal(shiftDateKey('2028-03-01',-1),'2028-02-29');
  assert.equal(shiftDateKey('',1),'');
});
