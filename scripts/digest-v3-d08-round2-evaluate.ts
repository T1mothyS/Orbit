import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractOfflineV3Source, type BoundedV3Source } from '../server/digest-v3-offline-extract.js';
import { suggestOfflineV3Match, type EventRelation, type FactChange, type OfflineV3Source,
  type OfflineV3Suggestion } from '../server/digest-v3-offline-match.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  raw: 'docs/digest-v3-d08-r2-bounded-sources.json',
  manual: 'docs/digest-v3-d08-r2-manual-fields.json',
  oracle: 'docs/digest-v3-d08-r2-oracle.json',
  matcher: 'server/digest-v3-offline-match.ts',
  extractor: 'server/digest-v3-offline-extract.ts',
};
const frozen = {
  matcher: 'd5779f29abb0e97c444923c532c632bb33a5c78c209e52775ef28c06dd713e94',
  extractor: '73dd1cc7a93d00803631986e295be53d003c9abb9de7fb1d292a2d361ad84454',
};
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');
const digest = (value: string) => crypto.createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');

type ManualAnnotation = Pick<OfflineV3Source, 'event' | 'facts'> & { id: string };
type OraclePair = { id: string; sources: [string, string]; eventRelation: EventRelation; factChange: FactChange };
type Row = { id: string; sourceIds: [string, string]; expected: { eventRelation: EventRelation; factChange: FactChange };
  suggestion: OfflineV3Suggestion; eventCorrect: boolean; factCorrect: boolean };

function abstain(ids: [string, string], issues: string[]): OfflineV3Suggestion {
  return { eventRelation: 'ambiguous', factChange: 'unknown', decision: 'ambiguous',
    candidateEventId: null, evidenceIds: [...ids].sort(), comparedFactKeys: [], addedFactKeys: [],
    omittedFactKeys: [], unknownFactKeys: [], reasons: [...new Set(issues)], mayReferenceSameEvent: false };
}

function score(rows: Row[]) {
  const ids = (predicate: (row: Row) => boolean) => rows.filter(predicate).map(row => row.id);
  return {
    count: rows.length,
    eventCorrect: ids(row => row.eventCorrect).length,
    factCorrect: ids(row => row.factCorrect).length,
    bothCorrect: ids(row => row.eventCorrect && row.factCorrect).length,
    falseMerges: ids(row => row.expected.eventRelation === 'different_event' && row.suggestion.eventRelation === 'same_event'),
    falseProgress: ids(row => row.expected.factChange !== 'material_change' && row.suggestion.factChange === 'material_change'),
    falseNoChange: ids(row => row.expected.factChange !== 'no_material_change' && row.suggestion.factChange === 'no_material_change'),
    eventMisses: ids(row => row.expected.eventRelation === 'same_event' && row.suggestion.eventRelation !== 'same_event'),
    factMisses: ids(row => ['material_change', 'no_material_change'].includes(row.expected.factChange) &&
      row.suggestion.factChange !== row.expected.factChange),
    ambiguousDecisions: ids(row => row.suggestion.decision === 'ambiguous'),
    uncertainAxes: ids(row => row.suggestion.eventRelation === 'ambiguous' || row.suggestion.factChange === 'unknown'),
  };
}

function manualSource(raw: BoundedV3Source, annotation: ManualAnnotation): OfflineV3Source {
  const url = new URL(raw.url);
  return { id: raw.id, url: raw.url, publisherKey: url.hostname.toLowerCase(),
    documentType: raw.documentType, language: raw.language, sourceFact: raw.excerpt,
    publishedAt: raw.publishedAt, publishedPrecision: raw.publishedPrecision,
    independenceKey: url.href, sourceDocumentKey: url.href,
    event: annotation.event, facts: annotation.facts };
}

function factFingerprint(fact: OfflineV3Source['facts'][number]): string {
  return JSON.stringify([fact.factKey, fact.scope, fact.unit, fact.value]);
}

export function runRound2Evaluation() {
  assert.equal(digest(read(files.matcher)), frozen.matcher, 'frozen matching rules changed');
  assert.equal(digest(read(files.extractor)), frozen.extractor, 'frozen extraction rules changed');
  const raw = JSON.parse(read(files.raw)) as { sources: BoundedV3Source[] };
  const annotations = JSON.parse(read(files.manual)) as { sources: ManualAnnotation[] };
  const oracle = JSON.parse(read(files.oracle)) as { pairs: OraclePair[] };
  const rawMap = new Map(raw.sources.map(source => [source.id, source]));
  const manualMap = new Map(annotations.sources.map(source => [source.id, source]));
  assert.equal(rawMap.size, raw.sources.length, 'duplicate source ID');
  assert.equal(manualMap.size, raw.sources.length, 'manual source count differs');
  const extracted = new Map(raw.sources.map(source => [source.id, extractOfflineV3Source(source)]));
  const sourceRows = raw.sources.map(source => {
    const reference = manualMap.get(source.id);
    const result = extracted.get(source.id);
    assert.ok(reference && result, `missing field reference for ${source.id}`);
    const identityCorrect = JSON.stringify(result.source?.event ?? null) === JSON.stringify(reference.event);
    const expectedFacts = reference.facts.map(factFingerprint).sort();
    const actualFacts = (result.source?.facts ?? []).map(factFingerprint).sort();
    return { id: source.id, url: source.url, identityCorrect,
      expectedEvent: reference.event, extractedEvent: result.source?.event ?? null,
      expectedFacts: reference.facts, extractedFacts: result.source?.facts ?? [],
      factFieldsCorrect: JSON.stringify(expectedFacts) === JSON.stringify(actualFacts), issues: result.issues };
  });
  const evaluate = (projection: (id: string) => OfflineV3Source | null, issues: (id: string) => string[]) => {
    let orderInvariant = true;
    const rows: Row[] = oracle.pairs.map(pair => {
      const [firstId, secondId] = pair.sources;
      const first = projection(firstId);
      const second = projection(secondId);
      const suggestion = first && second ? suggestOfflineV3Match(first, second)
        : abstain(pair.sources, [...issues(firstId), ...issues(secondId)]);
      if (first && second && JSON.stringify(suggestion) !== JSON.stringify(suggestOfflineV3Match(second, first)))
        orderInvariant = false;
      return { id: pair.id, sourceIds: pair.sources,
        expected: { eventRelation: pair.eventRelation, factChange: pair.factChange }, suggestion,
        eventCorrect: suggestion.eventRelation === pair.eventRelation,
        factCorrect: suggestion.factChange === pair.factChange };
    });
    return { metrics: score(rows), orderInvariant, rows };
  };
  const manual = evaluate(id => {
    const source = rawMap.get(id);
    const annotation = manualMap.get(id);
    assert.ok(source && annotation, `missing manual projection for ${id}`);
    return manualSource(source, annotation);
  }, () => []);
  const independent = evaluate(id => {
    const result = extracted.get(id);
    assert.ok(result, `missing extraction for ${id}`);
    return result.source;
  }, id => extracted.get(id)?.issues ?? []);
  return {
    freeze: frozen, hashes: { raw: digest(read(files.raw)), manual: digest(read(files.manual)), oracle: digest(read(files.oracle)) },
    sources: { count: sourceRows.length, identityCorrect: sourceRows.filter(row => row.identityCorrect).length,
      factFieldsCorrect: sourceRows.filter(row => row.factFieldsCorrect).length, rows: sourceRows },
    manual, independent,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runRound2Evaluation();
  const base = path.join(root, 'dist-shadow');
  mkdirSync(base, { recursive: true });
  const outputDir = mkdtempSync(path.join(base, 'd08-r2-offline-'));
  writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outputDir, sources: { count: report.sources.count,
    identityCorrect: report.sources.identityCorrect, factFieldsCorrect: report.sources.factFieldsCorrect },
  manual: report.manual.metrics, independent: report.independent.metrics,
  orderInvariant: { manual: report.manual.orderInvariant, independent: report.independent.orderInvariant },
  hashes: report.hashes, freeze: report.freeze }));
}
