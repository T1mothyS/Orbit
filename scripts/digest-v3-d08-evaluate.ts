/** D08 offline-only replay. No activity store, Work, scheduler, or publication imports. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { suggestOfflineV3Match, type OfflineV3Source, type OfflineV3Suggestion,
  type EventRelation, type FactChange, type MatchDecision } from '../server/digest-v3-offline-match.js';
import { makePlan, publishedAt, type Candidate, type PlannedDay } from './digest-seven-day-simulation.js';

const ruleVersion = 'd08-r1';
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sourcePath = path.join(root, 'docs', 'daily-digest-v3-s2-01-cases.json');
const fieldsPath = path.join(root, 'docs', 'digest-v3-d08-source-fields.json');
const oraclePath = path.join(root, 'docs', 'digest-v3-d08-oracle.json');
const holdoutPath = path.join(root, 'docs', 'digest-v3-d08-holdout.json');
const rulePath = path.join(root, 'server', 'digest-v3-offline-match.ts');
const hash = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const hashTextFile = (file: string) => hash(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const opaqueId = (url: string) => `src-${hash(url).slice(0, 20)}`;

type CompactFields = { event: [string, string, string]; documentType: string;
  sourceDocumentKey?: string; facts: Array<[string, string | number | boolean | null, string, string?]> };
type RawSource = { id?: string; url: string; publishedAt: string | null; precision?: OfflineV3Source['publishedPrecision'];
  fact?: string; sourceFact?: string };
type Oracle = { eventRelation: EventRelation; factChange: FactChange; factKey?: string; scope?: string; unit?: string };
type PairRow = { id: string; expectedCategory: MatchDecision; sources: RawSource[] };

function project(raw: RawSource, fields: CompactFields): OfflineV3Source {
  const id = opaqueId(raw.url);
  return {
    id, url: raw.url, publisherKey: new URL(raw.url).hostname, documentType: fields.documentType,
    language: new URL(raw.url).pathname.startsWith('/es/') ? 'es' : 'en',
    sourceFact: raw.fact ?? raw.sourceFact ?? '', publishedAt: raw.publishedAt,
    publishedPrecision: raw.precision ?? (raw.publishedAt ? 'date' : 'unknown'),
    independenceKey: fields.sourceDocumentKey ?? id,
    sourceDocumentKey: fields.sourceDocumentKey ?? null,
    event: { eventType: fields.event[0], subjectKey: fields.event[1], occurrenceKey: fields.event[2] },
    facts: fields.facts.map(([factKey, value, scope, unit]) => ({ factKey, value, scope, unit: unit ?? null })),
  };
}
function sourceInputs(): { rows: PairRow[]; inputs: OfflineV3Source[][]; oracle: Record<string, Oracle> } {
  const baseline = read(sourcePath);
  const annotations = read(fieldsPath).sources as Record<string, CompactFields>;
  const oracle = read(oraclePath).pairs as Record<string, Oracle>;
  const rows = baseline.pairs as PairRow[];
  assert.equal(rows.length, 15);
  assert.equal(Object.keys(annotations).length, 30);
  assert.equal(Object.keys(oracle).length, 15);
  const inputs = rows.map(row => {
    assert.equal(row.sources.length, 2);
    assert.ok(oracle[row.id]);
    return row.sources.map(source => {
      assert.ok(source.id && annotations[source.id]);
      return project(source, annotations[source.id]);
    });
  });
  assert.equal(new Set(inputs.flat().map(source => source.id)).size, 30);
  return { rows, inputs, oracle };
}

type ScoredPair = { caseId: string; expectedCategory: MatchDecision; expected: Oracle;
  suggestion: OfflineV3Suggestion; correctEvent: boolean; correctFact: boolean };
function scoreMain(rows: PairRow[], inputs: OfflineV3Source[][], oracle: Record<string, Oracle>): ScoredPair[] {
  return rows.map((row, index) => {
    const suggestion = suggestOfflineV3Match(inputs[index][0], inputs[index][1]);
    assert.deepEqual(suggestion, suggestOfflineV3Match(inputs[index][1], inputs[index][0]),
      `${row.id}: pair order changed result`);
    const expected = oracle[row.id];
    return { caseId: row.id, expectedCategory: row.expectedCategory, expected, suggestion,
      correctEvent: suggestion.eventRelation === expected.eventRelation,
      correctFact: suggestion.factChange === expected.factChange };
  });
}
function scoreHoldout() {
  const rows = read(holdoutPath).pairs as Array<{ id: string; expected: Oracle;
    sources: Array<RawSource & CompactFields> }>;
  return rows.map(row => {
    const inputs = row.sources.map(source => project(source, source));
    const suggestion = suggestOfflineV3Match(inputs[0], inputs[1]);
    assert.deepEqual(suggestion, suggestOfflineV3Match(inputs[1], inputs[0]),
      `${row.id}: holdout pair order changed result`);
    return { caseId: row.id, expected: row.expected, suggestion,
      correctEvent: suggestion.eventRelation === row.expected.eventRelation,
      correctFact: suggestion.factChange === row.expected.factChange, inputs };
  });
}

function syntheticSource(candidate: Candidate): OfflineV3Source {
  const title = candidate.title;
  const summary = candidate.summary.replace(/\*\*/g, '');
  const named = summary.match(/模拟事件([A-Z])/);
  const subjectKey = title.includes('另一项目') ? `synthetic:other:${hash(title).slice(0, 10)}`
    : named ? `synthetic:${named[1]}` : `synthetic:${hash(title).slice(0, 10)}`;
  const state = summary.includes('首次公告') ? 'initial'
    : summary.includes('出现进展') || summary.includes('出现新变化') ? 'progress' : null;
  const sourceId = `src-${hash(`synthetic\0${candidate.sourceId}`).slice(0, 20)}`;
  return {
    id: sourceId, url: `https://example.invalid/offline/${sourceId}`,
    publisherKey: 'synthetic', documentType: 'synthetic_candidate', language: 'zh',
    sourceFact: `${title}：${summary}`, publishedAt: publishedAt(candidate), publishedPrecision: 'second',
    independenceKey: sourceId, sourceDocumentKey: sourceId,
    event: { eventType: 'mission', subjectKey, occurrenceKey: subjectKey },
    facts: state ? [{ factKey: 'state', value: state, unit: null, scope: subjectKey }] : [],
  };
}
type SyntheticRow = { day: number; candidateId: string; sourceId: string; expectedSelected: boolean;
  humanRelation: string; disposition: 'new_event' | 'duplicate' | 'progress' | 'no_material_change' | 'ambiguous' | 'after_cutoff';
  comparedTo: string | null; evidenceIds: string[]; reasons: string[]; suggestion: OfflineV3Suggestion | null };
function replaySynthetic(plan: PlannedDay[]): { rows: SyntheticRow[]; inputProjection: unknown } {
  const history: Array<{ source: OfflineV3Source; candidateId: string; firstSeenDay: number }> = [];
  const rows: SyntheticRow[] = [];
  const inputProjection: Array<{ cutoff: string; sources: OfflineV3Source[] }> = [];
  for (const day of plan) {
    const projected = day.candidates.map(candidate => ({ candidate, source: syntheticSource(candidate) }));
    inputProjection.push({ cutoff: day.cutoff, sources: projected.map(item => item.source) });
    projected.sort((a, b) => `${a.source.publishedAt}\0${a.source.id}`.localeCompare(`${b.source.publishedAt}\0${b.source.id}`));
    for (const { candidate, source } of projected) {
      let suggestion: OfflineV3Suggestion | null = null;
      let comparedTo: string | null = null;
      let disposition: SyntheticRow['disposition'] = 'new_event';
      if (Date.parse(source.publishedAt!) > Date.parse(day.cutoff)) {
        disposition = 'after_cutoff';
      } else {
        const candidates = history.map(prior => ({ prior, result: suggestOfflineV3Match(prior.source, source) }))
          .filter(item => item.result.eventRelation === 'same_event');
        const rank: Record<MatchDecision, number> = {
          duplicate: 0, no_material_change: 1, ambiguous: 2, progress: 3, different_event: 4,
        };
        candidates.sort((a, b) => rank[a.result.decision] - rank[b.result.decision] ||
          a.prior.firstSeenDay - b.prior.firstSeenDay ||
          a.prior.source.id.localeCompare(b.prior.source.id));
        const best = candidates[0];
        if (best) {
          suggestion = best.result;
          comparedTo = best.prior.candidateId;
          disposition = best.result.decision as SyntheticRow['disposition'];
        }
        history.push({ source, candidateId: candidate.id, firstSeenDay: day.day });
      }
      rows.push({ day: day.day, candidateId: candidate.id, sourceId: source.id,
        expectedSelected: candidate.selected, humanRelation: candidate.relation,
        disposition, comparedTo, evidenceIds: suggestion?.evidenceIds ?? [source.id],
        reasons: suggestion?.reasons ?? [disposition === 'after_cutoff'
          ? '来源发表时间晚于本期截点，留待后期' : '此前没有相同事件身份的合格候选'],
        suggestion });
    }
  }
  rows.sort((a, b) => a.day - b.day || a.candidateId.localeCompare(b.candidateId));
  return { rows, inputProjection };
}

function metrics(scored: ScoredPair[]) {
  const labels: MatchDecision[] = ['duplicate', 'different_event', 'progress', 'no_material_change', 'ambiguous'];
  const confusion = Object.fromEntries(labels.map(label => [label,
    Object.fromEntries(labels.map(predicted => [predicted, scored.filter(row =>
      row.expectedCategory === label && row.suggestion.decision === predicted).length]))]));
  const falseMerges = scored.filter(row =>
    (row.expected.eventRelation === 'different_event' || row.caseId === 'A01') &&
    row.suggestion.mayReferenceSameEvent);
  const hardMisses = scored.filter(row => ['duplicate', 'progress'].includes(row.expectedCategory) &&
    row.suggestion.eventRelation === 'different_event');
  const pendingMatches = scored.filter(row => ['duplicate', 'progress'].includes(row.expectedCategory) &&
    row.suggestion.decision === 'ambiguous');
  const tracked = scored.filter(row => !!row.expected.factKey);
  const trackedNoChangeMisses = tracked.filter(row => row.suggestion.factChange !== 'no_material_change');
  const trackedNoChangeFalsePositives = scored.filter(row => row.suggestion.decision === 'no_material_change' &&
    row.expected.factChange !== 'no_material_change');
  const ambiguous = scored.filter(row => row.suggestion.decision === 'ambiguous');
  return {
    count: scored.length, confusion,
    eventCorrect: scored.filter(row => row.correctEvent).length,
    factCorrect: scored.filter(row => row.correctFact).length,
    bothCorrect: scored.filter(row => row.correctEvent && row.correctFact).length,
    falseMerges: falseMerges.map(row => row.caseId), hardMisses: hardMisses.map(row => row.caseId),
    pendingMatches: pendingMatches.map(row => row.caseId),
    trackedNoChange: { denominator: tracked.length, misses: trackedNoChangeMisses.map(row => row.caseId),
      falsePositives: trackedNoChangeFalsePositives.map(row => row.caseId) },
    ambiguous: { numerator: ambiguous.length, denominator: scored.length,
      byCategory: Object.fromEntries(labels.map(label => [label, {
        numerator: ambiguous.filter(row => row.expectedCategory === label).length,
        denominator: scored.filter(row => row.expectedCategory === label).length,
      }])) },
  };
}
function reportMarkdown(report: ReturnType<typeof runEvaluation>): string {
  const m = report.metrics;
  const pairRows = report.fixedCases.map(row => `| ${row.caseId} | ${row.expectedCategory} | ${row.suggestion.decision} | ${row.expected.eventRelation} / ${row.suggestion.eventRelation} | ${row.expected.factChange} / ${row.suggestion.factChange} | ${row.suggestion.evidenceIds.join(', ')} | ${row.suggestion.reasons.join('；')} |`).join('\n');
  const holdoutRows = report.holdout.rows.map(row => `| ${row.caseId} | ${row.expected.eventRelation} / ${row.suggestion.eventRelation} | ${row.expected.factChange} / ${row.suggestion.factChange} | ${row.suggestion.evidenceIds.join(', ')} | ${row.suggestion.reasons.join('；')} |`).join('\n');
  const simulationRows = report.simulation.rows.map(row => `| ${row.day} | ${row.candidateId} | ${row.disposition} | ${row.comparedTo ?? '—'} | ${row.evidenceIds.join(', ')} | ${row.reasons.join('；')} | ${row.expectedSelected ? '是' : '否'} |`).join('\n');
  const labels: MatchDecision[] = ['duplicate', 'different_event', 'progress', 'no_material_change', 'ambiguous'];
  const matrix = labels.map(label => `| ${label} | ${labels.map(predicted => m.confusion[label][predicted]).join(' | ')} |`).join('\n');
  return `# D08 第一轮离线匹配评测\n\n规则：${report.ruleVersion}；全部数据为固定来源摘要或合成候选。本报告不代表实时网页、Work、正式日报或生产。\n\n` +
    `- 固定案例：${m.count} 组；事件关系正确 ${m.eventCorrect}/${m.count}，事实变化正确 ${m.factCorrect}/${m.count}，两轴同时正确 ${m.bothCorrect}/${m.count}。\n` +
    `- 错合并 ${m.falseMerges.length}；硬漏匹配 ${m.hardMisses.length}；应关联却待定 ${m.pendingMatches.length}。\n` +
    `- 不确定 ${m.ambiguous.numerator}/${m.ambiguous.denominator}；跟踪指标无变化漏判 ${m.trackedNoChange.misses.length}/${m.trackedNoChange.denominator}，误判 ${m.trackedNoChange.falsePositives.length}。\n` +
    `- 保留样例：事件 ${report.holdout.eventCorrect}/${report.holdout.count}，事实 ${report.holdout.factCorrect}/${report.holdout.count}；全部固定与保留样例交换 A/B 后结果相同。\n` +
    `- 哈希：input ${report.hashes.input}; oracle ${report.hashes.oracle}; rule ${report.hashes.rule}; baseline ${report.hashes.baseline}; holdout ${report.hashes.holdout}.\n\n` +
    `## 五类混淆矩阵\n\n行是原 S2-01 人工类别，列是建议。\n\n| 人工\\建议 | ${labels.join(' | ')} |\n| --- | ${labels.map(() => '---:').join(' | ')} |\n${matrix}\n\n` +
    `## 固定案例逐例\n\n| 案例 | 人工五类 | 建议五类 | 事件：人工 / 建议 | 事实：人工 / 建议 | 证据 ID | 理由 |\n| --- | --- | --- | --- | --- | --- | --- |\n${pairRows}\n\n` +
    `## 预留合成样例逐例\n\n| 样例 | 事件：人工 / 建议 | 事实：人工 / 建议 | 证据 ID | 理由 |\n| --- | --- | --- | --- | --- |\n${holdoutRows}\n\n` +
    `## 七期原始合成候选\n\n| 期 | 候选 | 建议 | 比较候选 | 证据 ID | 理由 | 人工入选 |\n| --- | --- | --- | --- | --- | --- | --- |\n${simulationRows}\n\n` +
    `候选 ID 和人工入选仅用于报告与评分，未传给匹配器；算法收到的是不带答案的匿名来源投影。\n`;
}
export function runEvaluation() {
  const { rows, inputs, oracle } = sourceInputs();
  const fixedCases = scoreMain(rows, inputs, oracle);
  const holdoutRows = scoreHoldout();
  const plan = makePlan();
  const simulation = replaySynthetic(plan);
  const reversed = replaySynthetic(plan.map(day => ({ ...day, candidates: [...day.candidates].reverse() })));
  assert.deepEqual(simulation.rows, reversed.rows, 'synthetic candidate order changed results');
  const inputProjection = { fixedPairs: inputs, holdoutPairs: holdoutRows.map(row => row.inputs),
    syntheticDays: simulation.inputProjection };
  const serializedInput = JSON.stringify(inputProjection);
  assert.ok(!/expectedCategory|expectedDecision|reprintRelation|selected|eventKey|humanRelation|D01-A|A01-B/.test(serializedInput),
    'oracle field leaked into matcher input');
  const metric = metrics(fixedCases);
  assert.ok(metric.ambiguous.numerator < metric.count, 'all-ambiguous output cannot pass');
  const report = {
    ruleVersion, fixedCases, metrics: metric,
    holdout: { count: holdoutRows.length,
      eventCorrect: holdoutRows.filter(row => row.correctEvent).length,
      factCorrect: holdoutRows.filter(row => row.correctFact).length,
      rows: holdoutRows.map(({ inputs: _inputs, ...rest }) => rest) },
    simulation: { rows: simulation.rows,
      count: simulation.rows.length,
      ambiguous: simulation.rows.filter(row => row.disposition === 'ambiguous').length,
      afterCutoff: simulation.rows.filter(row => row.disposition === 'after_cutoff').length,
      selectedByHuman: simulation.rows.filter(row => row.expectedSelected).length },
    orderInvariant: true,
    hashes: { input: hash(serializedInput), oracle: hashTextFile(oraclePath),
      rule: hashTextFile(rulePath), baseline: hashTextFile(sourcePath),
      holdout: hashTextFile(holdoutPath), annotations: hashTextFile(fieldsPath) },
  };
  return { ...report, inputProjection };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runEvaluation();
  const outputRoot = path.join(root, 'dist-shadow');
  fs.mkdirSync(outputRoot, { recursive: true });
  const outputDir = fs.mkdtempSync(path.join(outputRoot, 'd08-offline-'));
  fs.writeFileSync(path.join(outputDir, 'input-projection.json'), JSON.stringify(result.inputProjection, null, 2));
  fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outputDir, 'report.md'), reportMarkdown(result));
  console.log(JSON.stringify({ outputDir, metrics: result.metrics, holdout: result.holdout,
    simulation: { count: result.simulation.count, ambiguous: result.simulation.ambiguous,
      afterCutoff: result.simulation.afterCutoff, selectedByHuman: result.simulation.selectedByHuman },
    orderInvariant: result.orderInvariant, hashes: result.hashes }));
}
