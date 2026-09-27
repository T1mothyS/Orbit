import assert from 'node:assert/strict';
import test from 'node:test';
import { runFactSafetyEvaluation } from './digest-v3-d08-fact-safety-evaluate.js';

test('frozen extractor scores every untouched bounded source with exact fact support', () => {
  const report = runFactSafetyEvaluation();
  assert.equal(report.metrics.sourceCount, 20);
  assert.equal(report.rows.length, 20);
  assert.ok(report.metrics.phaseKnownCount > 0);
  assert.ok(report.rows.some(row => row.extracted.phaseStatus === 'explicit_unknown'));
  assert.ok(report.rows.some(row => row.extracted.phaseStatus === 'known'));
});
