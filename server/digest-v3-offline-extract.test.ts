import assert from 'node:assert/strict';
import test from 'node:test';
import { extractOfflineV3Source, type BoundedV3Source } from './digest-v3-offline-extract.js';
import { suggestOfflineV3Match } from './digest-v3-offline-match.js';

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
  assert.equal(result.factEvidence[0]?.supportText, 'target range for the federal funds rate is at 2.25 to 2.50 percent');
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

function crewExcerpt(title: string, excerpt: string) {
  return extractOfflineV3Source({ ...base, title, excerpt, url: 'https://example.org/crew-status' });
}

test('a negated launch is unknown rather than completed', () => {
  const excerpt = 'NASA says Crew-12 has not launched.';
  const result = crewExcerpt('NASA Crew-12 launch update', excerpt);
  assert.equal(result.source?.facts.find(fact => fact.factKey === 'flight_phase')?.value, null);
  assert.equal(result.factEvidence[0]?.supportText, excerpt);
});

test('a planned docking tomorrow is unknown rather than completed', () => {
  const excerpt = 'NASA expects Crew-12 docking tomorrow.';
  const result = crewExcerpt('NASA Crew-12 docking plan', excerpt);
  assert.equal(result.source?.facts.find(fact => fact.factKey === 'flight_phase')?.value, null);
  assert.equal(result.factEvidence[0]?.supportText, excerpt);
});

test('conditional, historical-other-mission and multi-stage mentions cannot assert a current stage', () => {
  const cases = [
    ['If Crew-12 docked tomorrow, the handover could begin.', null],
    ['Crew-12 will dock tomorrow; Crew-11 launched last month.', null],
    ['Crew-12 launched last week and docked yesterday.', null],
  ] as const;
  for (const [excerpt, expected] of cases) {
    const result = crewExcerpt('NASA Crew-12 update', excerpt);
    assert.equal(result.source?.facts.find(fact => fact.factKey === 'flight_phase')?.value, expected, excerpt);
  }
});

test('one completed stage survives a separate future plan, with exact excerpt support', () => {
  const excerpt = 'Crew-12 launched today. Crew-12 is scheduled to dock tomorrow.';
  const result = crewExcerpt('NASA Crew-12 status', excerpt);
  assert.equal(result.source?.facts.find(fact => fact.factKey === 'flight_phase')?.value, 'launched');
  assert.equal(result.factEvidence[0]?.supportText, 'Crew-12 launched today.');
  assert.equal(result.factEvidence[0]?.field, 'excerpt');
});

test('historical background about another crew is not assigned to the title mission', () => {
  const result = crewExcerpt('NASA Crew-12 status', 'Crew-11 launched last month. Crew-12 is scheduled to dock tomorrow.');
  assert.equal(result.source?.event.subjectKey, 'crew-12');
  assert.equal(result.source?.facts.find(fact => fact.factKey === 'flight_phase')?.value, null);
});

test('retrospective same-mission mention and contradictory correction stay unknown', () => {
  const historical = crewExcerpt('NASA Crew-12 status', 'Crew-12 launched last year during its earlier flight.');
  assert.equal(historical.source?.facts.find(fact => fact.factKey === 'flight_phase')?.value, null);
  const contradicted = crewExcerpt('NASA Crew-12 status', 'Crew-12 launched today. NASA later said Crew-12 had not launched.');
  assert.equal(contradicted.source?.facts.find(fact => fact.factKey === 'flight_phase')?.value, null);
});

test('title alone cannot verify a stage or actual crew count', () => {
  const result = crewExcerpt('NASA Crew-12 launches', 'NASA discussed the Crew-12 mission with four astronauts.');
  assert.equal(result.source?.facts.find(fact => fact.factKey === 'flight_phase')?.value, null);
  assert.equal(result.source?.facts.some(fact => fact.factKey === 'crew_count'), false);
  assert.equal(result.factEvidence[0]?.field, 'title');
  assert.equal(result.factEvidence[0]?.supportText, 'NASA Crew-12 launches');
});

test('each extracted fact has exact source support and ambiguous title identities abstain', () => {
  const raw = { title: 'NASA Crew-12 status', excerpt: 'Crew-12 launched with four astronauts.' };
  const launched = crewExcerpt(raw.title, raw.excerpt);
  assert.equal(launched.source?.facts.length, launched.factEvidence.length);
  for (const support of launched.factEvidence) {
    assert.equal(launched.source?.facts[support.factIndex] !== undefined, true);
    assert.equal(support.supportText, raw[support.field].slice(support.start, support.end));
  }
  const ambiguous = crewExcerpt('NASA Crew-12 and Crew-13 status', 'Crew-12 launched. Crew-13 docked.');
  assert.equal(ambiguous.source, null);
});

test('completed stage and future stage in one sentence stay separate', () => {
  const result = crewExcerpt('NASA Crew-12 status', 'Crew-12 launched today and will dock tomorrow.');
  assert.equal(result.source?.facts.find(fact => fact.factKey === 'flight_phase')?.value, 'launched');
});

test('reported denial and planned crew count do not become observed facts', () => {
  const denied = crewExcerpt('NASA Crew-12 status', 'NASA denied claims that Crew-12 launched.');
  assert.equal(denied.source?.facts.find(fact => fact.factKey === 'flight_phase')?.value, null);
  const planned = crewExcerpt('NASA Crew-12 plan', 'Crew-12 will dock with four astronauts tomorrow.');
  assert.equal(planned.source?.facts.find(fact => fact.factKey === 'flight_phase')?.value, null);
  assert.equal(planned.source?.facts.some(fact => fact.factKey === 'crew_count'), false);
  const mixed = crewExcerpt('NASA Crew-12 status', 'Crew-12 launched today and is expected to dock tomorrow with four astronauts.');
  assert.equal(mixed.source?.facts.find(fact => fact.factKey === 'flight_phase')?.value, 'launched');
  assert.equal(mixed.source?.facts.some(fact => fact.factKey === 'crew_count'), false);
});

test('an unknown planned phase cannot become a match progress suggestion', () => {
  const first = extractOfflineV3Source({ ...base, title: 'NASA Crew-12 status', excerpt: 'Crew-12 launched today.',
    publishedAt: '2025-04-12', url: 'https://example.org/launch' });
  const later = extractOfflineV3Source({ ...base, title: 'NASA Crew-12 plan', excerpt: 'Crew-12 is scheduled to dock tomorrow.',
    publishedAt: '2025-04-13', url: 'https://example.org/dock-plan' });
  assert.ok(first.source && later.source);
  const suggestion = suggestOfflineV3Match(first.source, later.source);
  assert.equal(suggestion.eventRelation, 'same_event');
  assert.equal(suggestion.factChange, 'unknown');
  assert.equal(suggestion.decision, 'ambiguous');
});
