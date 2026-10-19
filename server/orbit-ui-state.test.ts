import test from 'node:test';
import assert from 'node:assert/strict';
import { ORBIT_QUIPS,shuffledQuips } from '../src/utils/orbit-quips.js';
import { parseStatisticsFilters } from '../src/utils/statistics-filters.js';
test('quip bags preserve every supplied phrase once and avoid repetition between bags',()=>{
  const first=shuffledQuips(undefined,()=>0.5),second=shuffledQuips(first.at(-1),()=>0.5);
  assert.equal(first.length,24);assert.equal(new Set(first).size,24);assert.deepEqual([...first].sort(),[...ORBIT_QUIPS].sort());assert.notEqual(second[0],first.at(-1));assert.ok(!ORBIT_QUIPS.some(text=>text.includes('DeepSeek')));
});
test('statistics filters reject arrays, missing fields, unknown keys and invalid enum values',()=>{
  for(const value of [null,[],{},{taskType:['todo'],reportSource:'all'}, {taskType:'all'}, {taskType:'todo',reportSource:'bad'}, {taskType:'all',reportSource:'all',userId:'other'}])assert.throws(()=>parseStatisticsFilters(value),/统计筛选/);
  assert.deepEqual(parseStatisticsFilters({taskType:'reminder',reportSource:'local'}),{taskType:'reminder',reportSource:'local'});
});
