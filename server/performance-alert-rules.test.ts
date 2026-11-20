import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePerformanceAlert, type ApiTiming } from './performance-alert-rules.js';

const now = 1_000_000;
const sample = (id: string, at: number, durationMs: number, status = 200): ApiTiming => ({
  operationId: id, observedAt: at, durationMs, status,
});

test('personal traffic raises an operational alert after three independent slow operations', () => {
  const two = [sample('one', now - 2000, 2300), sample('two', now - 1000, 2500)];
  assert.equal(evaluatePerformanceAlert([...two, sample('two', now, 2700)], now).active, false);
  const result = evaluatePerformanceAlert([...two, sample('three', now, 2700)], now);
  assert.equal(result.active, true);
  assert.equal(result.rule, 'REPEATED_SLOW_OPERATION');
  assert.equal(result.metrics.count, 3);
});

test('statistical alert needs two observed windows and can detect elevated errors', () => {
  const windows = [now - 320_000, now - 1000].flatMap(at =>
    Array.from({ length: 30 }, (_, index) => sample(`${at}-${index}`, at, 100, index < 3 ? 503 : 200)));
  const result = evaluatePerformanceAlert(windows, now);
  assert.equal(result.active, true);
  assert.equal(result.rule, 'STATISTICAL_API');
  assert.equal(evaluatePerformanceAlert(windows.slice(30), now).active, false);
});

test('recovery requires new healthy operations after the incident, not silence', () => {
  assert.equal(evaluatePerformanceAlert([], now, now - 10_000).recovered, false);
  const healthy = ['one', 'two', 'three'].map(id => sample(id, now - 1000, 250));
  assert.equal(evaluatePerformanceAlert(healthy, now, now - 10_000).recovered, true);
  assert.equal(evaluatePerformanceAlert(healthy, now, now - 100).recovered, false);
});
