import assert from 'node:assert/strict';
import test from 'node:test';
import {scheduleItemsForPlan} from '../src/utils/plan-schedule-items.js';

test('pure creation hides reference context; mixed drafts retain only existing targets', () => {
  const items=[{id:'today',title:'今日安排'},{id:'future',title:'未来安排'},{id:'target',title:'修改目标'}];
  assert.deepEqual(scheduleItemsForPlan(items,[{type:'create'},{type:'create_recurring'}]),[]);
  assert.deepEqual(scheduleItemsForPlan(items,[{type:'create'},{type:'update',scheduleId:'target'}]),[items[2]]);
  assert.deepEqual(scheduleItemsForPlan(items,[{type:'delete',scheduleId:'future'}]),[items[1]]);
  assert.deepEqual(scheduleItemsForPlan(items,[]),[]);
});
