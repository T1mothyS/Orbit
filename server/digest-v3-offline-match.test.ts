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
