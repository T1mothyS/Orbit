import type { OfflineV3Source } from './digest-v3-offline-match.js';

/** A short, frozen excerpt of a public source. No expected result or hand-selected V3 fact is accepted. */
export type BoundedV3Source = {
  id: string;
  url: string;
  title: string;
  excerpt: string;
  publishedAt: string | null;
  publishedPrecision: OfflineV3Source['publishedPrecision'];
  documentType: string;
  language: string;
};
export type FactSupport = {
  factIndex: number;
  field: 'title' | 'excerpt';
  start: number;
  end: number;
  supportText: string;
};
export type OfflineV3Extraction = { source: OfflineV3Source | null; factEvidence: FactSupport[]; issues: string[] };

const rawFields = new Set([
  'id', 'url', 'title', 'excerpt', 'publishedAt', 'publishedPrecision', 'documentType', 'language',
]);
const months: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const counts: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
type Fact = OfflineV3Source['facts'][number];
type Span = { text: string; start: number; end: number };

/** Sentence boundaries are only a conservative locality limit, not a general English parser. */
function sentences(value: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  for (const match of value.matchAll(/[.!?]\s+(?=[A-Z])/g)) {
    const end = match.index + 1;
    if (/[ap]\.m\.$/i.test(value.slice(start, end))) continue;
    const text = value.slice(start, end).trim();
    if (text) spans.push({ text, start: start + value.slice(start, end).indexOf(text), end: start + value.slice(start, end).indexOf(text) + text.length });
    start = match.index + match[0].length;
  }
  const text = value.slice(start).trim();
  if (text) spans.push({ text, start: start + value.slice(start).indexOf(text), end: start + value.slice(start).indexOf(text) + text.length });
  return spans;
}

const crewPattern = /\bCrew[\s-]?(\d{1,2})\b/gi;
const stageMention = /\b(?:launch(?:ed|es|ing)?|lift(?:ed|s|ing)? off|dock(?:ed|s|ing)?|splash(?:ed|es|ing)? down|splashdown|land(?:ed|s|ing)?)\b/gi;
const nonActualBefore = /\b(?:not|never|without|if|unless|whether|will|would|could|might|may|should|expect(?:ed|s)?|plan(?:ned|s)?|schedul(?:ed|es|ing)?|target(?:ed|s)?|anticipat(?:ed|es|ing)?|pending|attempt(?:ed|s)?|previously|earlier|denied|denies|disputed|disputes|retracted|retracts)\b|\blast\s+(?:week|month|year)\b|\b(?:set|due|yet)\s+to\b|n't\b/i;
const nonActualAfter = /\b(?:tomorrow|next\s+(?:day|week|month|year)|last\s+(?:week|month|year)|later|earlier|previously|upcoming|planned|scheduled|expected)\b|\?/i;
const contradictsCompleted = /\b(?:not|never|without|previously|earlier|denied|denies|disputed|disputes|retracted|retracts)\b|\blast\s+(?:week|month|year)\b|n't\b/i;

function stageValue(word: string): 'launched' | 'docked' | 'splashdown' | null {
  if (/^(?:launched|launches|lifted off|lifts off|lifting off)$/i.test(word)) return 'launched';
  if (/^(?:docked|docks)$/i.test(word)) return 'docked';
  if (/^(?:splashed down|landed|lands)$/i.test(word)) return 'splashdown';
  return null;
}

function stageMentionsForCrew(excerpt: string, crewNumber: number) {
  const actual: Array<{ value: NonNullable<ReturnType<typeof stageValue>>; span: Span; countSpan: Span }> = [];
  const uncertain: Array<{ span: Span; disqualifies: boolean }> = [];
  for (const sentence of sentences(excerpt)) {
    const mentions = [...sentence.text.matchAll(crewPattern)];
    for (let i = 0; i < mentions.length; i++) {
      if (Number(mentions[i][1]) !== crewNumber) continue;
      const start = i === 0 ? 0 : mentions[i].index;
      const end = i + 1 < mentions.length ? mentions[i + 1].index : sentence.text.length;
      const clause = sentence.text.slice(start, end);
      const stages = [...clause.matchAll(stageMention)];
      for (let j = 0; j < stages.length; j++) {
        const stage = stages[j];
        const before = clause.slice(0, stage.index);
        const boundary = Math.max(before.lastIndexOf(';'), before.lastIndexOf(','),
          before.lastIndexOf(' and '), before.lastIndexOf(' but '));
        const localBefore = before.slice(boundary < 0 ? 0 : boundary + 1);
        const next = j + 1 < stages.length ? stages[j + 1].index : clause.length;
        const betweenStages = clause.slice(stage.index + stage[0].length, next);
        const connector = betweenStages.search(/\s+(?:and|but)\s+|[;,]/i);
        const after = connector < 0 ? betweenStages : betweenStages.slice(0, connector);
        const countStart = sentence.start + start + (boundary < 0 ? 0 : boundary + 1);
        const countEnd = sentence.start + start + stage.index + stage[0].length + after.length;
        const countSpan = { text: excerpt.slice(countStart, countEnd), start: countStart, end: countEnd };
        const value = stageValue(stage[0]);
        if (value && !nonActualBefore.test(localBefore) && !nonActualAfter.test(after))
          actual.push({ value, span: sentence, countSpan });
        else uncertain.push({ span: sentence,
          disqualifies: contradictsCompleted.test(localBefore) || contradictsCompleted.test(after) });
      }
    }
  }
  return { actual, uncertain };
}

function meetingDate(text: string): string | null {
  const match = text.match(/\bmeeting\s+(?:on|of|held on)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:\s*[-–]\s*)?(\d{1,2})?,?\s+(20\d{2})\b/i);
  if (!match) return null;
  const month = months[match[1].toLowerCase()];
  const day = Number(match[2] ?? text.match(/\bmeeting\s+(?:on|of|held on)\s+\w+\s+(\d{1,2})/i)?.[1]);
  const date = `${match[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function extractOfflineV3Source(raw: BoundedV3Source): OfflineV3Extraction {
  if (!raw || typeof raw !== 'object' || Object.keys(raw).some(key => !rawFields.has(key)))
    throw new Error('D08 raw source contains unknown fields');
  if (!raw.id || !raw.title || !raw.excerpt || raw.title.length > 300 || raw.excerpt.length > 1200 ||
    !raw.documentType || !raw.language) throw new Error('D08 raw source is incomplete or unbounded');
  const url = new URL(raw.url);
  if (url.protocol !== 'https:') throw new Error('D08 raw source must be public HTTPS');
  const text = `${raw.title}. ${raw.excerpt}`;
  const issues: string[] = [];
  let event: OfflineV3Source['event'] | null = null;
  const facts: OfflineV3Source['facts'] = [];
  const factEvidence: FactSupport[] = [];
  const addFact = (fact: Fact, field: FactSupport['field'], start: number, end: number) => {
    const supportText = raw[field].slice(start, end);
    if (!supportText) throw new Error('D08 extracted fact lacks source support');
    factEvidence.push({ factIndex: facts.length, field, start, end, supportText });
    facts.push(fact);
  };

  if (/\b(?:Federal Open Market Committee|FOMC)\b/i.test(text)) {
    const occurrenceKey = meetingDate(text);
    if (occurrenceKey) event = { eventType: 'meeting', subjectKey: 'fomc', occurrenceKey };
    else issues.push('未从正文取得明确会议日期');
    const rate = text.match(/\b(?:target range for the federal funds rate|federal funds target range)\b[^.;]{0,80}?\b(?:at|to)\s+(\d+(?:\.\d+)?)\s*(?:to|[-–])\s*(\d+(?:\.\d+)?)\s*(?:%|percent\b)/i);
    if (rate) {
      const supportStart = raw.excerpt.indexOf(rate[0]);
      if (supportStart >= 0) addFact({ factKey: 'target_range', value: `${Number(rate[1]).toFixed(2)}-${Number(rate[2]).toFixed(2)}`,
        unit: '%', scope: 'federal_funds' }, 'excerpt', supportStart, supportStart + rate[0].length);
    } else {
      const unknownRate = raw.excerpt.match(/\b(?:target range for the federal funds rate|federal funds target range)\b[^.;]{0,80}\b(?:unknown|not specified)\b/i);
      if (unknownRate) {
        const start = unknownRate.index ?? raw.excerpt.indexOf(unknownRate[0]);
        addFact({ factKey: 'target_range', value: null, unit: '%', scope: 'federal_funds' },
          'excerpt', start, start + unknownRate[0].length);
      }
    }
  } else {
    const titleCrews = [...raw.title.matchAll(crewPattern)].map(match => Number(match[1]));
    const excerptCrews = [...raw.excerpt.matchAll(crewPattern)].map(match => Number(match[1]));
    const titleIds = [...new Set(titleCrews)];
    const excerptIds = [...new Set(excerptCrews)];
    const crewNumber = titleIds.length === 1 ? titleIds[0] : titleIds.length === 0 && excerptIds.length === 1 ? excerptIds[0] : null;
    if (crewNumber !== null && /\bNASA\b/i.test(text)) {
      const mission = `crew-${crewNumber}`;
      event = { eventType: 'mission', subjectKey: mission, occurrenceKey: mission };
      const stage = stageMentionsForCrew(raw.excerpt, crewNumber);
      const values = [...new Set(stage.actual.map(item => item.value))];
      const conflicting = values.length > 1 || stage.uncertain.some(item => item.disqualifies);
      if (values.length === 1 && !conflicting) {
        const supported = stage.actual.find(item => item.value === values[0])!;
        addFact({ factKey: 'flight_phase', value: values[0], unit: null, scope: mission },
          'excerpt', supported.span.start, supported.span.end);
        const count = supported.countSpan.text.match(/\b(one|two|three|four|five|six|[1-6])\s+(?:NASA\s+)?(?:astronauts|crew members)\b/i);
        if (count) addFact({ factKey: 'crew_count', value: counts[count[1].toLowerCase()] ?? Number(count[1]),
          unit: 'people', scope: mission }, 'excerpt', supported.countSpan.start, supported.countSpan.end);
      } else if (conflicting || stage.uncertain.length || new RegExp(stageMention.source, 'i').test(raw.title)) {
        const span = conflicting ? { text: raw.excerpt, start: 0, end: raw.excerpt.length }
          : stage.uncertain[0]?.span;
        const field = span ? 'excerpt' : 'title';
        const start = span?.start ?? 0;
        const end = span?.end ?? raw.title.length;
        addFact({ factKey: 'flight_phase', value: null, unit: null, scope: mission }, field, start, end);
        issues.push(conflicting ? '同一摘录含多个已发生阶段，当前阶段未确认' : '阶段提及不是明确的已发生事实');
      }
    }
  }
  if (!event) {
    issues.push('事件身份未能安全抽取');
    return { source: null, factEvidence: [], issues };
  }
  if (facts.length === 0) issues.push('未抽取到可比事实');
  return { source: {
    id: raw.id, url: raw.url, publisherKey: url.hostname.toLowerCase(),
    documentType: raw.documentType, language: raw.language, sourceFact: raw.excerpt,
    publishedAt: raw.publishedAt, publishedPrecision: raw.publishedPrecision,
    independenceKey: url.href, sourceDocumentKey: url.href, event, facts,
  }, factEvidence, issues };
}
