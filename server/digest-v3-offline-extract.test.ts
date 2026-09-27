import assert from 'node:assert/strict';
import test from 'node:test';
import { extractOfflineV3Source, type BoundedV3Source } from './digest-v3-offline-extract.js';

const base: BoundedV3Source = {
  id: 'opaque-1', url: 'https://example.org/release',
  title: 'FOMC statement',
  excerpt: 'The Federal Open Market Committee met at its meeting on April 12, 2022. The target range for the federal funds rate is at 2.25 to 2.50 percent.',
  publishedAt: '2022-04-12', publishedPrecision: 'date', documentType: 'statement', language: 'en',
};

test('extracts meeting identity and a scoped known metric without any answer fields', () => {
  const result = extractOfflineV3Source(base);
  assert.deepEqual(result.source?.event, { eventType: 'meeting', subjectKey: 'fomc', occurrenceKey: '2022-04-12' });
  assert.deepEqual(result.source?.facts, [{ factKey: 'target_range', value: '2.25-2.50', unit: '%', scope: 'federal_funds' }]);
  assert.deepEqual(result.issues, []);
  assert.throws(() => extractOfflineV3Source({ ...base, selected: true } as BoundedV3Source), /unknown fields/);
});

test('range meeting date and an unknown rate do not invent a value', () => {
  const result = extractOfflineV3Source({ ...base,
    excerpt: 'The FOMC met at its meeting on April 11-12, 2022. The federal funds target range is not specified.' });
  assert.equal(result.source?.event.occurrenceKey, '2022-04-12');
  assert.equal(result.source?.facts[0]?.value, null);
});

test('extracts mission stages and crew counts while preserving bounded coverage', () => {
  const launched = extractOfflineV3Source({ ...base, title: 'NASA SpaceX Crew-12 launches',
    excerpt: 'NASA said Crew-12 launched with four astronauts.', url: 'https://example.org/crew-launch' });
  const docked = extractOfflineV3Source({ ...base, title: 'NASA SpaceX Crew-12 docks',
    excerpt: 'NASA said Crew-12 docked at the station.', url: 'https://example.org/crew-dock' });
  assert.deepEqual(launched.source?.event, docked.source?.event);
  assert.deepEqual(launched.source?.facts.map(fact => fact.factKey), ['flight_phase', 'crew_count']);
  assert.deepEqual(docked.source?.facts.map(fact => fact.factKey), ['flight_phase']);
});

test('missing explicit identity abstains instead of using publication date or URL slug', () => {
  const result = extractOfflineV3Source({ ...base, title: 'Policy decision',
    excerpt: 'A target range was discussed, but the meeting date was not stated.' });
  assert.equal(result.source, null);
  assert.ok(result.issues.includes('事件身份未能安全抽取'));
});
