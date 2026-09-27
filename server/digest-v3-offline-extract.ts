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
export type OfflineV3Extraction = { source: OfflineV3Source | null; issues: string[] };

const rawFields = new Set([
  'id', 'url', 'title', 'excerpt', 'publishedAt', 'publishedPrecision', 'documentType', 'language',
]);
const months: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const counts: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

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

  if (/\b(?:Federal Open Market Committee|FOMC)\b/i.test(text)) {
    const occurrenceKey = meetingDate(text);
    if (occurrenceKey) event = { eventType: 'meeting', subjectKey: 'fomc', occurrenceKey };
    else issues.push('未从正文取得明确会议日期');
    const rate = text.match(/\b(?:target range for the federal funds rate|federal funds target range)\b[^.;]{0,80}?\b(?:at|to)\s+(\d+(?:\.\d+)?)\s*(?:to|[-–])\s*(\d+(?:\.\d+)?)\s*(?:%|percent\b)/i);
    if (rate) facts.push({ factKey: 'target_range', value: `${Number(rate[1]).toFixed(2)}-${Number(rate[2]).toFixed(2)}`,
      unit: '%', scope: 'federal_funds' });
    else if (/\b(?:target range for the federal funds rate|federal funds target range)\b[^.;]{0,80}\b(?:unknown|not specified)\b/i.test(text))
      facts.push({ factKey: 'target_range', value: null, unit: '%', scope: 'federal_funds' });
  } else {
    const crew = text.match(/\bCrew[\s-]?(\d{1,2})\b/i);
    if (crew && /\bNASA\b/i.test(text)) {
      const mission = `crew-${Number(crew[1])}`;
      event = { eventType: 'mission', subjectKey: mission, occurrenceKey: mission };
      const phase = /\b(?:splashed down|splashdown|landed)\b/i.test(text) ? 'splashdown'
        : /\b(?:docked|docking)\b/i.test(text) ? 'docked'
          : /\b(?:launched|launches|lifted off|lifts off)\b/i.test(text) ? 'launched' : null;
      if (phase) facts.push({ factKey: 'flight_phase', value: phase, unit: null, scope: mission });
      const count = text.match(/\b(one|two|three|four|five|six|[1-6])\s+(?:NASA\s+)?(?:astronauts|crew members)\b/i);
      if (count) facts.push({ factKey: 'crew_count', value: counts[count[1].toLowerCase()] ?? Number(count[1]),
        unit: 'people', scope: mission });
    }
  }
  if (!event) {
    issues.push('事件身份未能安全抽取');
    return { source: null, issues };
  }
  if (facts.length === 0) issues.push('未抽取到可比事实');
  return { source: {
    id: raw.id, url: raw.url, publisherKey: url.hostname.toLowerCase(),
    documentType: raw.documentType, language: raw.language, sourceFact: raw.excerpt,
    publishedAt: raw.publishedAt, publishedPrecision: raw.publishedPrecision,
    independenceKey: url.href, sourceDocumentKey: url.href, event, facts,
  }, issues };
}
