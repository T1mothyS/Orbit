import crypto from 'node:crypto';
import net from 'node:net';
import { isValidDateKey } from './date-key.js';

export const DIGEST_V2_VERSION = 'daily-digest.v2';
export const DIGEST_V2_GENERATION = '2026-09-24.1';
export type CheckStatus = 'complete' | 'partial' | 'failed' | 'not_configured';
export interface InputItem { id: string; title: string; detail: string }
export interface InputSection { status: CheckStatus; items: InputItem[] }
export interface DigestSnapshot {
  date: string; timezone: string; cutoff: string; contextVersion: number;
  calendar: InputSection; mail: InputSection; watchlist: InputSection;
}
export function digestSnapshotWarnings(snapshot: DigestSnapshot, generationVersion = DIGEST_V2_GENERATION): string[] {
  if (generationVersion === '2026-09-21.1' || generationVersion === '2026-09-22.2') {
    return (['calendar', 'mail', 'watchlist'] as const).filter(section => ['failed', 'partial'].includes(snapshot[section].status)).map(section => `${section.toUpperCase()}_INCOMPLETE`);
  }
  return (['calendar', 'mail', 'watchlist'] as const).flatMap(section => {
    const status = snapshot[section].status;
    if (section === 'mail' && status === 'not_configured') return ['MAIL_NOT_CONFIGURED'];
    if (section === 'mail' && status === 'failed') return ['MAIL_READ_FAILED'];
    return status === 'failed' || status === 'partial' ? [`${section.toUpperCase()}_INCOMPLETE`] : [];
  });
}
export interface DigestEvidence { id: string; url: string; source: string; published_at: string }
export interface DigestStory {
  id: string; title: string; summary: string; evidence_ids: string[]; media_ids: string[];
  verification: 'verified' | 'partial' | 'unverified';
}
export interface DigestMedia { id: string; evidence_id: string; url: string; category: string }
export interface DigestV2 {
  schema_version: 'daily-digest.v2'; date: string; title: string;
  executive_signals: string[];
  calendar: Array<{ input_id: string; text: string }>;
  mail: Array<{ input_id: string; summary: string; action: string }>;
  market: DigestStory[]; macro: DigestStory[]; stories: DigestStory[];
  watchlist: Array<{ input_id: string; summary: string; check: 'complete' | 'incomplete'; change: 'material' | 'nothing_material' | 'unknown'; evidence_ids: string[] }>;
  what_matters_next: string[]; evidence: DigestEvidence[]; media: DigestMedia[];
}
type Schema = { type: 'object' | 'array' | 'string'; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: false; items?: Schema; maxItems?: number; minLength?: number; maxLength?: number; enum?: readonly string[]; format?: 'id' | 'url' | 'date' | 'timestamp' };
const str = (maxLength = 2000): Schema => ({ type: 'string', maxLength });
const id: Schema = { ...str(100), minLength: 1, format: 'id' };
const array = (items: Schema, maxItems = 100): Schema => ({ type: 'array', items, maxItems });
const obj = (properties: Record<string, Schema>): Schema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const refs = array(id, 20);
const story = obj({ id, title: { ...str(250), minLength: 1 }, summary: { ...str(4000), minLength: 1 }, evidence_ids: refs, media_ids: refs, verification: { ...str(), enum: ['verified', 'partial', 'unverified'] } });
export const DIGEST_V2_SCHEMA = obj({
  schema_version: { ...str(), enum: [DIGEST_V2_VERSION] }, date: { ...str(), format: 'date' }, title: { ...str(200), minLength: 1 },
  executive_signals: array({ ...str(500), minLength: 1 }, 5), calendar: array(obj({ input_id: id, text: { ...str(), minLength: 1 } }), 300),
  mail: array(obj({ input_id: id, summary: { ...str(3000), minLength: 1 }, action: str() })),
  market: array(story, 30), macro: array(story, 30), stories: array(story, 30),
  watchlist: array(obj({ input_id: id, summary: str(), check: { ...str(), enum: ['complete', 'incomplete'] }, change: { ...str(), enum: ['material', 'nothing_material', 'unknown'] }, evidence_ids: refs })),
  what_matters_next: array(str(1000), 20),
  evidence: array(obj({ id, url: { ...str(2048), format: 'url' }, source: { ...str(200), minLength: 1 }, published_at: { ...str(40), format: 'timestamp' } }), 200),
  media: array(obj({ id, evidence_id: id, url: { ...str(2048), format: 'url' }, category: { ...str(), enum: ['AI', 'Semiconductor', 'Banking', 'Macro', 'Gaming', 'China', 'International', 'Company', 'Market'] } }), 20),
});

/** No DNS/network here. The fetch boundary independently validates DNS and redirects. */
export function publicDigestUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && !net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && u.hostname.includes('.')
      && !/(^|\.)(localhost|local|internal|lan|test|invalid)$/.test(u.hostname)
      && !u.hostname.endsWith('.home.arpa') && !/[\u0000-\u0020\u007f]/.test(value)
      && ![...u.searchParams.keys()].some(k => /^(token|access_token|api_key|authorization|signature|x-amz-credential|x-amz-signature)$/i.test(k));
  } catch { return false; }
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function digestHash(value: unknown): string { return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex'); }
export interface DigestIssue { path: string; code: string }
export function validateDigestV2(value: unknown, snapshot?: DigestSnapshot, generationVersion = DIGEST_V2_GENERATION) {
  const errors: DigestIssue[] = [];
  const issue = (path: string, code: string) => { if (errors.length < 100) errors.push({ path, code }); };
  function visit(v: unknown, s: Schema, path: string): void {
    if (s.type === 'object') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return issue(path, 'TYPE_OBJECT');
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) if (!Object.hasOwn(s.properties!, k)) issue(path, 'UNKNOWN_FIELD');
      for (const [k, sub] of Object.entries(s.properties!)) {
        if (!Object.hasOwn(o, k)) issue(`${path}.${k}`, 'REQUIRED'); else visit(o[k], sub, `${path}.${k}`);
      }
    } else if (s.type === 'array') {
      if (!Array.isArray(v)) return issue(path, 'TYPE_ARRAY');
      if (v.length > s.maxItems!) return issue(path, 'TOO_MANY');
      v.forEach((item, i) => visit(item, s.items!, `${path}[${i}]`));
    } else {
      if (typeof v !== 'string') return issue(path, 'TYPE_STRING');
      if (v.trim().length < (s.minLength || 0) || v.length > s.maxLength!) issue(path, 'LENGTH');
      if (s.enum && !s.enum.includes(v)) issue(path, 'ENUM');
      if (s.format === 'id' && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/.test(v)) issue(path, 'ID');
      if (s.format === 'date' && !isValidDateKey(v)) issue(path, 'DATE');
      if (s.format === 'timestamp' && v !== '' && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v)))) issue(path, 'TIMESTAMP');
      if (s.format === 'url' && !publicDigestUrl(v)) issue(path, 'URL');
      if (/(?:\bBearer\s+[A-Za-z0-9._~-]{16,}|\b(?:password|api[_-]?key|secret)\s*[:=]\s*\S{8,}|[A-Za-z]:\\)/i.test(v)) issue(path, 'SENSITIVE_CONTENT');
    }
  }
  if (Buffer.byteLength(JSON.stringify(value) || '') > 750_000) issue('$', 'SIZE_LIMIT');
  else visit(value, DIGEST_V2_SCHEMA, '$');
  if (errors.length) return { valid: false, errors, warnings: [] as string[], contentHash: null };
  const d = value as DigestV2;
  const unique = (ids: string[], path: string) => { if (new Set(ids).size !== ids.length) issue(path, 'DUPLICATE_ID'); };
  const stories = [...d.market, ...d.macro, ...d.stories];
  unique(stories.map(x => x.id), '$.stories'); unique(d.evidence.map(x => x.id), '$.evidence'); unique(d.media.map(x => x.id), '$.media');
  const eids = new Set(d.evidence.map(x => x.id)); const mids = new Set(d.media.map(x => x.id));
  for (const [i, s] of [...stories, ...d.watchlist].entries()) {
    unique(s.evidence_ids, `$.references[${i}]`);
    if (s.evidence_ids.some(id => !eids.has(id))) issue(`$.references[${i}]`, 'EVIDENCE_NOT_FOUND');
  }
  for (const [i, s] of stories.entries()) {
    unique(s.media_ids, `$.stories[${i}].media_ids`);
    if (s.verification === 'verified' && !s.evidence_ids.length) issue(`$.stories[${i}]`, 'EVIDENCE_REQUIRED');
    if (s.media_ids.some(id => !mids.has(id))) issue(`$.stories[${i}]`, 'MEDIA_NOT_FOUND');
    if (s.media_ids.some(id => !s.evidence_ids.includes(d.media.find(m => m.id === id)?.evidence_id || ''))) issue(`$.stories[${i}]`, 'MEDIA_EVIDENCE_MISMATCH');
  }
  for (const [i, m] of d.media.entries()) {
    if (!eids.has(m.evidence_id)) issue(`$.media[${i}]`, 'EVIDENCE_NOT_FOUND');
    if (!stories.some(s => s.media_ids.includes(m.id))) issue(`$.media[${i}]`, 'UNREFERENCED_MEDIA');
  }
  for (const [i, w] of d.watchlist.entries()) {
    if (w.change !== 'unknown' && (w.check !== 'complete' || !w.evidence_ids.length)) issue(`$.watchlist[${i}]`, 'CHECK_EVIDENCE_REQUIRED');
  }
  if (snapshot) {
    if (d.date !== snapshot.date) issue('$.date', 'SNAPSHOT_DATE_MISMATCH');
    for (const section of ['calendar', 'mail', 'watchlist'] as const) {
      const supplied = d[section].map(x => x.input_id); const expected = snapshot[section].items.map(x => x.id);
      unique(supplied, `$.${section}`);
      if (expected.some(id => !supplied.includes(id))) issue(`$.${section}`, 'INPUT_OMITTED');
      if (supplied.some(id => !expected.includes(id))) issue(`$.${section}`, 'UNKNOWN_INPUT');
    }
  }
  const warnings = snapshot ? digestSnapshotWarnings(snapshot, generationVersion) : [];
  return { valid: errors.length === 0, errors, warnings, contentHash: errors.length ? null : digestHash({ digest: d, inputWarnings: warnings }) };
}
