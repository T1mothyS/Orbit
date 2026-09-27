import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractOfflineV3Source, type BoundedV3Source } from '../server/digest-v3-offline-extract.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  extractor: 'server/digest-v3-offline-extract.ts',
  raw: 'docs/digest-v3-d08-r3-bounded-sources.json',
  oracle: 'docs/digest-v3-d08-r3-oracle.json',
};
// Recorded before the new bounded sources and scorer labels were authored.
const frozenExtractor = '3cbab1841081eb86cef800df7d9993dcf0f293bd10f8d08a673797fffcda8644';
const rawFields = new Set([
  'id', 'url', 'title', 'excerpt', 'publishedAt', 'publishedPrecision', 'documentType', 'language',
]);
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');
const digest = (value: string) => crypto.createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');

type Phase = 'launched' | 'docked' | 'splashdown' | null;
type Gold = { id: string; subjectKey: string; flightPhase: Phase; crewCount: number | null };
type Field = 'flight_phase' | 'crew_count';

export function runFactSafetyEvaluation() {
  assert.equal(digest(read(files.extractor)), frozenExtractor, 'D08 fact-status rules changed after freeze');
  const raw = JSON.parse(read(files.raw)) as { sources: BoundedV3Source[] };
  const oracle = JSON.parse(read(files.oracle)) as { sources: Gold[] };
  assert.equal(raw.sources.length, 20, 'holdout denominator changed');
  const labels = new Map(oracle.sources.map(item => [item.id, item]));
  assert.equal(labels.size, raw.sources.length, 'holdout labels missing or duplicated');
  assert.equal(new Set(raw.sources.map(item => item.id)).size, raw.sources.length, 'duplicate raw source ID');

  const rows = raw.sources.map(source => {
    assert.deepEqual(Object.keys(source).sort(), [...rawFields].sort(), `raw input contains answer fields: ${source.id}`);
    const result = extractOfflineV3Source(source);
    const label = labels.get(source.id);
    assert.ok(label, `missing scorer-only label: ${source.id}`);
    assert.equal(result.source?.facts.length ?? 0, result.factEvidence.length, `fact support missing: ${source.id}`);
    for (const support of result.factEvidence) {
      assert.ok(result.source?.facts[support.factIndex], `support has no fact: ${source.id}`);
      assert.equal(support.supportText, source[support.field].slice(support.start, support.end),
        `support is not an exact source span: ${source.id}`);
      assert.ok(support.supportText.length > 0, `empty fact support: ${source.id}`);
    }
    const phaseFact = result.source?.facts.find(fact => fact.factKey === 'flight_phase');
    const countFact = result.source?.facts.find(fact => fact.factKey === 'crew_count');
    const flightPhase = (phaseFact?.value ?? null) as Phase;
    const crewCount = (countFact?.value ?? null) as number | null;
    const falseFacts: Field[] = [];
    const missedFacts: Field[] = [];
    if (flightPhase !== null && flightPhase !== label.flightPhase) falseFacts.push('flight_phase');
    if (crewCount !== null && crewCount !== label.crewCount) falseFacts.push('crew_count');
    if (label.flightPhase !== null && flightPhase !== label.flightPhase) missedFacts.push('flight_phase');
    if (label.crewCount !== null && crewCount !== label.crewCount) missedFacts.push('crew_count');
    return { id: source.id, excerpt: source.excerpt, expected: label,
      extracted: { subjectKey: result.source?.event.subjectKey ?? null, flightPhase, crewCount,
        phaseStatus: phaseFact ? (phaseFact.value === null ? 'explicit_unknown' : 'known') : 'not_extracted' },
      identityCorrect: result.source?.event.subjectKey === label.subjectKey,
      falseFacts, missedFacts, factEvidence: result.factEvidence, issues: result.issues };
  });
  assert.deepEqual([...labels.keys()].sort(), rows.map(row => row.id).sort(), 'scorer has extra labels');
  const falseFacts = rows.flatMap(row => row.falseFacts.map(field => ({ id: row.id, field })));
  const missedFacts = rows.flatMap(row => row.missedFacts.map(field => ({ id: row.id, field })));
  const phaseUncertain = rows.filter(row => row.extracted.flightPhase === null).map(row => row.id);
  const countUncertain = rows.filter(row => row.extracted.crewCount === null).map(row => row.id);
  const knownPhaseCount = rows.length - phaseUncertain.length;
  assert.ok(knownPhaseCount > 0, 'all-unknown phase output is not an acceptable evaluation');
  return { freeze: { extractor: frozenExtractor },
    hashes: { raw: digest(read(files.raw)), oracle: digest(read(files.oracle)) },
    metrics: { sourceCount: rows.length, identityCorrect: rows.filter(row => row.identityCorrect).length,
      factSupportCount: rows.reduce((count, row) => count + row.factEvidence.length, 0),
      falseFacts, missedFacts, falseFactCount: falseFacts.length, missedFactCount: missedFacts.length,
      phaseKnownCount: knownPhaseCount, phaseUncertainCount: phaseUncertain.length,
      phaseUncertainRate: phaseUncertain.length / rows.length, phaseUncertain,
      countKnownCount: rows.length - countUncertain.length, countUncertainCount: countUncertain.length,
      countUncertainRate: countUncertain.length / rows.length, countUncertain },
    rows };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runFactSafetyEvaluation();
  const base = path.join(root, 'dist-shadow');
  mkdirSync(base, { recursive: true });
  const outputDir = mkdtempSync(path.join(base, 'd08-r3-fact-safety-'));
  writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outputDir, freeze: report.freeze, hashes: report.hashes, metrics: report.metrics }));
}
