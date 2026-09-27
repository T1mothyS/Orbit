import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestOfflineV3Match, type OfflineV3Source } from './digest-v3-offline-match.js';
import { runEvaluation } from '../scripts/digest-v3-d08-evaluate.js';

function source(id: string, occurrenceKey: string, value: string, overrides: Partial<OfflineV3Source> = {}): OfflineV3Source {
  return {
    id, url: `https://example.org/${id}`, publisherKey: 'example.org', documentType: 'statement',
    language: 'en', sourceFact: `Tracked value ${value}`, publishedAt: '2025-01-01',
    publishedPrecision: 'date', independenceKey: id, sourceDocumentKey: null,
    event: { eventType: 'meeting', subjectKey: 'committee', occurrenceKey },
    facts: [{ factKey: 'target_range', value, unit: '%', scope: 'policy_rate' }],
    ...overrides,
  };
}

test('same metric value across different meetings never proposes an event link', () => {
  const result = suggestOfflineV3Match(source('one', '2025-01-01', '4.25-4.50'),
    source('two', '2025-03-01', '4.25-4.50'));
  assert.equal(result.eventRelation, 'different_event');
  assert.equal(result.factChange, 'no_material_change');
  assert.equal(result.candidateEventId, null);
  assert.equal(result.mayReferenceSameEvent, false);
});

test('same document translation with conflicting facts stays uncertain', () => {
  const prior = source('one', 'flight-1', 'approved', {
    event: { eventType: 'mission', subjectKey: 'ship', occurrenceKey: 'flight-1' },
    sourceDocumentKey: 'official-faq', facts: [{ factKey: 'return_status', value: 'approved', unit: null, scope: 'ship' }],
  });
  const current = source('two', 'flight-1', 'pending', {
    event: prior.event, sourceDocumentKey: 'official-faq',
    facts: [{ factKey: 'return_status', value: 'pending', unit: null, scope: 'ship' }],
  });
  const result = suggestOfflineV3Match(prior, current);
  assert.equal(result.eventRelation, 'same_event');
  assert.equal(result.factChange, 'unknown');
  assert.equal(result.decision, 'ambiguous');
  assert.equal(result.mayReferenceSameEvent, false);
  assert.deepEqual(result, suggestOfflineV3Match(current, prior));
});

test('a changed non-stage claim is not silently promoted to progress', () => {
  const event = { eventType: 'mission', subjectKey: 'ship', occurrenceKey: 'flight-1' };
  const first = source('one', 'flight-1', 'approved', { event, publishedAt: '2025-01-01',
    facts: [{ factKey: 'return_status', value: 'approved', unit: null, scope: 'ship' }] });
  const second = source('two', 'flight-1', 'pending', { event, publishedAt: '2025-01-03',
    facts: [{ factKey: 'return_status', value: 'pending', unit: null, scope: 'ship' }] });
  const result = suggestOfflineV3Match(first, second);
  assert.equal(result.factChange, 'unknown');
  assert.equal(result.decision, 'ambiguous');
});

test('matcher rejects scoring and selection fields in its input', () => {
  const first = source('one', '2025-01-01', '4.25-4.50');
  const second = source('two', '2025-03-01', '4.25-4.50');
  assert.throws(() => suggestOfflineV3Match({ ...first, expectedCategory: 'duplicate' } as OfflineV3Source, second),
    /unknown fields/);
  assert.throws(() => suggestOfflineV3Match(first, { ...second, selected: true } as OfflineV3Source),
    /unknown fields/);
});

test('a repeated source keeps one evidence citation', () => {
  const repeated = source('same-source', '2025-01-01', '4.25-4.50',
    { sourceDocumentKey: 'release-1' });
  const result = suggestOfflineV3Match(repeated, repeated);
  assert.equal(result.decision, 'duplicate');
  assert.deepEqual(result.evidenceIds, ['same-source']);
});

test('omitting an earlier fact alone does not create progress', () => {
  const event = { eventType: 'mission', subjectKey: 'probe', occurrenceKey: 'flight-1' };
  const state = { factKey: 'flight_phase', value: 'launched', unit: null, scope: 'probe' };
  const first = source('initial', 'flight-1', 'launched', { event, publishedAt: '2025-01-01',
    facts: [state, { factKey: 'crew_count', value: 4, unit: 'people', scope: 'probe' }] });
  const later = source('later', 'flight-1', 'launched', { event, publishedAt: '2025-01-03', facts: [state] });
  const result = suggestOfflineV3Match(first, later);
  assert.equal(result.eventRelation, 'same_event');
  assert.equal(result.factChange, 'unknown');
  assert.equal(result.decision, 'ambiguous');
});

test('two unknown metric values do not establish no change', () => {
  const unknown = { factKey: 'target_range', value: null, unit: '%', scope: 'policy_rate' };
  const first = source('one', '2025-01-01', 'unknown', { facts: [unknown] });
  const later = source('two', '2025-03-01', 'unknown', { facts: [unknown] });
  const result = suggestOfflineV3Match(first, later);
  assert.equal(result.eventRelation, 'different_event');
  assert.equal(result.factChange, 'unknown');
  assert.notEqual(result.decision, 'no_material_change');
});

test('new known mission fact is progress while omission alone is not', () => {
  const event = { eventType: 'mission', subjectKey: 'probe', occurrenceKey: 'flight-1' };
  const phase = { factKey: 'flight_phase', value: 'launched', unit: null, scope: 'probe' };
  const count = { factKey: 'crew_count', value: 4, unit: 'people', scope: 'probe' };
  const prior = source('prior', 'flight-1', 'launched', { event, publishedAt: '2025-01-01', facts: [phase, count] });
  const added = source('added', 'flight-1', 'launched', { event, publishedAt: '2025-01-03',
    facts: [phase, count, { factKey: 'arrival_status', value: 'arrived', unit: null, scope: 'probe' }] });
  const result = suggestOfflineV3Match(prior, added);
  assert.equal(result.eventRelation, 'same_event');
  assert.equal(result.factChange, 'material_change');
  assert.equal(result.decision, 'progress');
  assert.deepEqual(result.addedFactKeys, ['arrival_status/probe']);
  assert.deepEqual(result.omittedFactKeys, []);
  assert.deepEqual(result, suggestOfflineV3Match(added, prior));

  const omittedAndAdded = source('mixed', 'flight-1', 'launched', { event, publishedAt: '2025-01-04',
    facts: [phase, { factKey: 'arrival_status', value: 'arrived', unit: null, scope: 'probe' }] });
  const mixed = suggestOfflineV3Match(prior, omittedAndAdded);
  assert.equal(mixed.factChange, 'material_change');
  assert.deepEqual(mixed.omittedFactKeys, ['crew_count/probe']);
  assert.deepEqual(mixed.addedFactKeys, ['arrival_status/probe']);
});

test('unknown new value, known to unknown, and unknown to unknown stay uncertain', () => {
  const event = { eventType: 'mission', subjectKey: 'probe', occurrenceKey: 'flight-1' };
  const phase = { factKey: 'flight_phase', value: 'launched', unit: null, scope: 'probe' };
  const prior = source('prior', 'flight-1', 'launched', { event, facts: [phase] });
  const unknownAdded = source('unknown-added', 'flight-1', 'launched', { event, publishedAt: '2025-01-03',
    facts: [phase, { factKey: 'crew_count', value: null, unit: 'people', scope: 'probe' }] });
  const unknown = suggestOfflineV3Match(prior, unknownAdded);
  assert.equal(unknown.factChange, 'unknown');
  assert.deepEqual(unknown.unknownFactKeys, ['crew_count/probe']);

  const known = source('known', 'flight-1', '4', { event, facts: [{ factKey: 'crew_count', value: 4, unit: 'people', scope: 'probe' }] });
  const missing = source('missing', 'flight-1', 'unknown', { event, publishedAt: '2025-01-03',
    facts: [{ factKey: 'crew_count', value: null, unit: 'people', scope: 'probe' }] });
  assert.equal(suggestOfflineV3Match(known, missing).factChange, 'unknown');
  assert.equal(suggestOfflineV3Match(missing, missing).factChange, 'unknown');
});

test('contradiction and incomplete independent summaries are not no-change or progress', () => {
  const event = { eventType: 'mission', subjectKey: 'probe', occurrenceKey: 'flight-1' };
  const fact = { factKey: 'return_status', value: 'approved', unit: null, scope: 'probe' };
  const prior = source('prior', 'flight-1', 'approved', { event, facts: [fact] });
  const contradiction = source('contradiction', 'flight-1', 'pending', { event, publishedAt: '2025-01-03',
    facts: [{ ...fact, value: 'pending' }] });
  assert.equal(suggestOfflineV3Match(prior, contradiction).factChange, 'unknown');
  const internal = source('internal', 'flight-1', 'disputed', { event, publishedAt: '2025-01-03',
    facts: [fact, { ...fact, value: 'pending' }] });
  assert.equal(suggestOfflineV3Match(prior, internal).factChange, 'unknown');
  const independent = source('independent', 'flight-1', 'same claim in different summary',
    { event, publishedAt: '2025-01-03', facts: [fact] });
  assert.equal(suggestOfflineV3Match(prior, independent).factChange, 'unknown');
});

test('publication time precision and timezone control directional progress', () => {
  const event = { eventType: 'mission', subjectKey: 'probe', occurrenceKey: 'flight-1' };
  const phase = (value: string) => [{ factKey: 'flight_phase', value, unit: null, scope: 'probe' }];
  const prior = source('prior', 'flight-1', 'launched', { event, facts: phase('launched'),
    publishedAt: '2025-01-02T23:59:00-05:00', publishedPrecision: 'minute' });
  const later = source('later', 'flight-1', 'orbit', { event, facts: phase('orbit'),
    publishedAt: '2025-01-03T05:01:00Z', publishedPrecision: 'minute' });
  assert.equal(suggestOfflineV3Match(prior, later).decision, 'progress');
  const sameMinute = { ...later, publishedAt: '2025-01-03T04:59:30Z', publishedPrecision: 'second' as const };
  assert.equal(suggestOfflineV3Match(prior, sameMinute).factChange, 'unknown');
  const dateOnly = { ...later, publishedAt: '2025-01-03', publishedPrecision: 'date' as const };
  assert.equal(suggestOfflineV3Match(prior, dateOnly).factChange, 'unknown');
  const reversed = { ...later, publishedAt: '2025-01-02T23:58:00-05:00' };
  assert.equal(suggestOfflineV3Match(prior, reversed).factChange, 'unknown');
  assert.throws(() => suggestOfflineV3Match(prior, { ...later, publishedAt: null, publishedPrecision: 'date' }),
    /precision is invalid/);
  assert.throws(() => suggestOfflineV3Match(prior, { ...later, publishedAt: '2025-02-30', publishedPrecision: 'date' }),
    /precision is invalid/);
});

test('fixed, heldout and seven-period offline replay remain scored and order invariant', () => {
  const result = runEvaluation();
  assert.equal(result.metrics.count, 15);
  assert.equal(result.metrics.falseMerges.length, 0);
  assert.equal(result.metrics.eventCorrect, 15);
  assert.equal(result.metrics.factCorrect, 15);
  assert.ok(result.metrics.ambiguous.numerator < 15);
  assert.equal(result.holdout.count, 7);
  assert.equal(result.holdout.eventCorrect, 7);
  assert.equal(result.holdout.factCorrect, 7);
  assert.equal(result.simulation.count, 21);
  assert.equal(result.simulation.rows.find(row => row.candidateId === 'b-reprint')?.disposition, 'ambiguous');
  assert.equal(result.simulation.rows.find(row => row.candidateId === 'e-too-late')?.disposition, 'after_cutoff');
  assert.equal(result.orderInvariant, true);
});
