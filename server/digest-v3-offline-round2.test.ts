import assert from 'node:assert/strict';
import test from 'node:test';
import { runRound2Evaluation } from '../scripts/digest-v3-d08-round2-evaluate.js';

test('frozen rules score every bounded source pair on both independent input tracks', () => {
  const result = runRound2Evaluation();
  assert.equal(result.sources.count, 12);
  assert.equal(result.manual.metrics.count, 13);
  assert.equal(result.independent.metrics.count, 13);
  assert.equal(result.manual.orderInvariant, true);
  assert.equal(result.independent.orderInvariant, true);
  assert.deepEqual(result.manual.metrics.falseMerges, []);
  assert.deepEqual(result.independent.metrics.falseMerges, []);
  assert.deepEqual(result.manual.metrics.falseProgress, []);
  assert.deepEqual(result.independent.metrics.falseProgress, []);
  assert.deepEqual(result.manual.metrics.falseNoChange, []);
  assert.deepEqual(result.independent.metrics.falseNoChange, []);
  assert.ok(result.manual.metrics.ambiguousDecisions.length < 13);
  assert.ok(result.independent.metrics.ambiguousDecisions.length < 13);
});
