import crypto from 'node:crypto';
import { publicDigestUrl } from './digest-v2-contract.js';
import { DigestV3Conflict, frozenCitationHash, type DigestV3Analysis, type DigestV3Event, type DigestV3Evidence, type DigestV3Fact, type DigestV3Revision, type DigestV3Store } from './digest-v3-store.js';

type ObjectValue = Record<string, unknown>;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/;
const sensitivePattern = /(?:\bBearer\s+[A-Za-z0-9._~-]{16,}|\b(?:password|api[_-]?key|secret)\s*[:=]\s*\S{8,}|[A-Za-z]:\\)/i;

function object(value: unknown, fields: string[]): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(key => !fields.includes(key))) throw new Error('V3 本地输入字段无效');
  return value as ObjectValue;
}
function text(value: unknown, max: number, id = false): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max ||
    sensitivePattern.test(value) || (id && !idPattern.test(value))) throw new Error('V3 本地输入文本无效');
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    !Number.isFinite(Date.parse(`${value.slice(0, 10)}T00:00:00Z`)) ||
    new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new Error('V3 本地截点无效');
  }
  return value;
}
export function validatedV3Cutoff(value: unknown): string { return new Date(instant(value)).toISOString(); }
export function validatedV3Id(value: unknown): string { return text(value, 100, true); }
function sourceTime(value: unknown, precision: unknown, cutoff: string): string | null {
  if (value === null && precision === 'unknown') return null;
  if (precision === 'date') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value ||
      value >= new Date(cutoff).toISOString().slice(0, 10)) throw new Error('V3 来源日期不能证明早于截点');
    return value;
  }
  if (precision !== 'minute' && precision !== 'second') throw new Error('V3 来源时间精度无效');
  const parsed = instant(value);
  if (Date.parse(parsed) > Date.parse(cutoff)) throw new Error('V3 来源晚于截点');
  return parsed;
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function keyId(userId: string, requestKey: string, type: string): string {
  return `v3-${type}-${crypto.createHash('sha256').update(`${userId}\0${requestKey}`).digest('hex').slice(0, 24)}`;
}

/** Explicit reviewed decision only; no automatic matching or public write interface. */
export function recordReviewedV3Source(store: DigestV3Store, userId: string, raw: unknown, clock: () => Date = () => new Date()) {
  text(userId, 100, true);
  const input = object(raw, ['requestKey', 'cutoff', 'eventId', 'event', 'expectedRevisionId', 'source', 'fact', 'analysis']);
  const requestKey = text(input.requestKey, 100, true);
  const eventId = text(input.eventId, 100, true);
  const cutoff = instant(input.cutoff);
  const now = clock().toISOString();
  if (Date.parse(cutoff) > Date.parse(now)) throw new Error('V3 截点晚于本地核对时间');
  const source = object(input.source, ['url', 'publisherKey', 'documentType', 'language', 'sourceFact', 'publishedAt', 'publishedPrecision', 'independenceKey']);
  const url = text(source.url, 2048);
  if (!publicDigestUrl(url)) throw new Error('V3 来源 URL 无效');
  const publishedAt = sourceTime(source.publishedAt, source.publishedPrecision, cutoff);
  const publisherKey = text(source.publisherKey, 100, true);
  const documentType = text(source.documentType, 80, true);
  const language = text(source.language, 20, true);
  const sourceFact = text(source.sourceFact, 1000);
  const independenceKey = text(source.independenceKey, 100, true);
  const factInput = object(input.fact, ['factKey', 'value', 'unit', 'scope']);
  const factKey = text(factInput.factKey, 100, true);
  const scope = text(factInput.scope, 100, true);
  const factValue = factInput.value;
  if (!(factValue === null || typeof factValue === 'boolean' ||
    (typeof factValue === 'number' && Number.isFinite(factValue)) ||
    (typeof factValue === 'string' && !!factValue.trim() && factValue.length <= 500 && !sensitivePattern.test(factValue)))) {
    throw new Error('V3 事实值无效');
  }
  const unit = factInput.unit === null ? null : text(factInput.unit, 60);
  const analysisInput = object(input.analysis, ['body']);
  const body = text(analysisInput.body, 1500);
  const isInitial = input.event !== undefined;
  if (isInitial === (input.expectedRevisionId !== undefined)) throw new Error('V3 初始或进展决定无效');
  const eventInput = isInitial ? object(input.event, ['eventType', 'subjectKey', 'occurrenceKey', 'title']) : null;
  const eventType = eventInput ? text(eventInput.eventType, 80, true) : null;
  const subjectKey = eventInput ? text(eventInput.subjectKey, 100, true) : null;
  const occurrenceKey = eventInput ? text(eventInput.occurrenceKey, 100, true) : null;
  const title = eventInput ? text(eventInput.title, 200) : null;
  const expectedRevisionId = isInitial ? null : text(input.expectedRevisionId, 100, true);
  const current = isInitial ? null : store.getEvent(userId, eventId);
  const previous = expectedRevisionId ? store.getRevision(userId, expectedRevisionId) : null;
  const evidenceId = keyId(userId, requestKey, 'evidence');
  const revisionId = keyId(userId, requestKey, 'revision');
  const analysisId = keyId(userId, requestKey, 'analysis');
  const fact: DigestV3Fact = { factKey, value: factValue as DigestV3Fact['value'], unit, scope, evidenceIds: [evidenceId] };
  const evidence: DigestV3Evidence = { id: evidenceId, userId, url, publisherKey, documentType,
    language, sourceFact, publishedAt, publishedPrecision: source.publishedPrecision as DigestV3Evidence['publishedPrecision'],
    retrievedAt: now, independenceKey, reviewState: 'verified' };
  const event: DigestV3Event | undefined = isInitial ? { id: eventId, userId, eventType: eventType!, subjectKey: subjectKey!,
    occurrenceKey: occurrenceKey!, title: title!, lifecycle: 'active', currentRevisionId: revisionId, createdAt: now } : undefined;
  const revision: DigestV3Revision = { id: revisionId, userId, eventId, revisionNo: isInitial ? 1 : (previous?.revisionNo ?? 0) + 1,
    previousRevisionId: expectedRevisionId, changeKind: isInitial ? 'initial' : 'progress', facts: [fact],
    evidenceIds: [evidenceId], recordedAt: now, decidedBy: 'user' };
  const analysis: DigestV3Analysis = { id: analysisId, userId, eventRevisionId: revisionId,
    evidenceIds: [evidenceId], comparedRevisionIds: expectedRevisionId ? [expectedRevisionId] : [],
    analysisKind: 'interpretation', body, authorKind: 'user', recordedAt: now };

  const existing = store.getEvidence(userId, evidenceId);
  if (existing) {
    const oldRevision = store.getRevision(userId, revisionId);
    const oldAnalysis = store.getAnalysis(userId, analysisId);
    const oldEvent = store.getEvent(userId, eventId);
    const sourceMatches = existing.url === url && existing.publisherKey === publisherKey &&
      existing.documentType === documentType && existing.language === language &&
      existing.sourceFact === sourceFact && existing.publishedAt === publishedAt &&
      existing.publishedPrecision === source.publishedPrecision && existing.independenceKey === independenceKey;
    const eventMatches = !!oldEvent && (!eventInput ||
      (oldEvent.eventType === eventType && oldEvent.subjectKey === subjectKey &&
        oldEvent.occurrenceKey === occurrenceKey && oldEvent.title === title));
    if (!sourceMatches || !eventMatches || !oldRevision || !oldAnalysis ||
      oldRevision.eventId !== eventId || oldRevision.changeKind !== revision.changeKind ||
      oldRevision.previousRevisionId !== expectedRevisionId || !same(oldRevision.facts, [fact]) ||
      !same(oldRevision.evidenceIds, [evidenceId]) || oldAnalysis.eventRevisionId !== revisionId ||
      oldAnalysis.body !== body || !same(oldAnalysis.evidenceIds, [evidenceId]) ||
      !same(oldAnalysis.comparedRevisionIds, analysis.comparedRevisionIds)) {
      throw new DigestV3Conflict('V3 幂等键与已有内容冲突');
    }
    return { eventId, evidenceId, revisionId, analysisId, status: 'existing' as const };
  }
  if (store.getRevision(userId, revisionId) || store.getAnalysis(userId, analysisId)) throw new DigestV3Conflict('V3 幂等记录不完整');
  if (isInitial && store.getEvent(userId, eventId)) throw new DigestV3Conflict('V3 事件已存在，需要明确进展决定');
  if (!isInitial && (!current || current.lifecycle !== 'active' || !previous || previous.eventId !== eventId ||
    current.currentRevisionId !== expectedRevisionId)) throw new DigestV3Conflict('V3 修订版本冲突');
  store.saveReviewedChain({ evidence, event, revision, analysis });
  return { eventId, evidenceId, revisionId, analysisId, status: 'created' as const };
}

function escaped(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function resolveReviewedCitation(store: DigestV3Store, userId: string,
  refs: { eventId: string; revisionId: string; analysisId: string; cutoff: string }) {
  text(userId, 100, true);
  for (const id of [refs.eventId, refs.revisionId, refs.analysisId]) text(id, 100, true);
  const cutoff = instant(refs.cutoff);
  const event = store.getEvent(userId, refs.eventId);
  const revision = store.getRevision(userId, refs.revisionId);
  const analysis = store.getAnalysis(userId, refs.analysisId);
  if (!event || !revision || !analysis || event.lifecycle !== 'active' ||
    Date.parse(event.createdAt) > Date.parse(cutoff) || revision.eventId !== event.id ||
    !['initial', 'progress'].includes(revision.changeKind) || analysis.analysisKind !== 'interpretation' ||
    analysis.eventRevisionId !== revision.id || Date.parse(revision.recordedAt) > Date.parse(cutoff) ||
    Date.parse(analysis.recordedAt) > Date.parse(cutoff)) throw new Error('V3 预览引用无效或晚于截点');
  const previous = revision.previousRevisionId ? store.getRevision(userId, revision.previousRevisionId) : null;
  if (revision.previousRevisionId && (!previous || previous.eventId !== event.id ||
    Date.parse(previous.recordedAt) > Date.parse(cutoff))) throw new Error('V3 预览前版引用无效');
  if ((revision.changeKind === 'initial' && (revision.previousRevisionId !== null || revision.revisionNo !== 1)) ||
    (revision.changeKind === 'progress' && (!previous || previous.revisionNo + 1 !== revision.revisionNo)) ||
    !same(analysis.comparedRevisionIds ?? [], previous ? [previous.id] : [])) {
    throw new Error('V3 预览版本链引用无效');
  }
  const evidence = revision.evidenceIds.map(id => store.getEvidence(userId, id));
  const earlierEvidence = previous?.evidenceIds.map(id => store.getEvidence(userId, id)) ?? [];
  if ([...evidence, ...earlierEvidence].some(item => !item || item.reviewState !== 'verified' ||
    !publicDigestUrl(item.url) || Date.parse(item.retrievedAt) > Date.parse(cutoff) ||
    (item.publishedAt && sourceTime(item.publishedAt, item.publishedPrecision, cutoff) === null)) ||
    !same(analysis.evidenceIds, revision.evidenceIds)) throw new Error('V3 预览来源引用无效');
  return { cutoff, event, revision, analysis, previous, evidence: evidence as DigestV3Evidence[],
    earlierEvidence: earlierEvidence as DigestV3Evidence[] };
}

/** Freeze a manually reviewed D07 chain for one local report citation slot. */
export function freezeReviewedV3Citation(store: DigestV3Store, userId: string, raw: unknown,
  clock: () => Date = () => new Date()) {
  text(userId, 100, true);
  const input = object(raw, ['reportDate', 'reportVersionKey', 'citationKey', 'eventId', 'revisionId', 'analysisId', 'evidenceIds', 'cutoff']);
  const reportDate = input.reportDate;
  if (typeof reportDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate) ||
    !Number.isFinite(Date.parse(`${reportDate}T00:00:00Z`)) ||
    new Date(`${reportDate}T00:00:00Z`).toISOString().slice(0, 10) !== reportDate) {
    throw new Error('V3 日报日期无效');
  }
  const reportVersionKey = text(input.reportVersionKey, 100, true);
  const citationKey = text(input.citationKey, 100, true);
  const eventId = text(input.eventId, 100, true);
  const revisionId = text(input.revisionId, 100, true);
  const analysisId = text(input.analysisId, 100, true);
  const cutoff = validatedV3Cutoff(input.cutoff);
  if (Date.parse(cutoff) > clock().getTime()) throw new Error('V3 截点晚于本地核对时间');
  if (!Array.isArray(input.evidenceIds) || !input.evidenceIds.length || input.evidenceIds.length > 100) {
    throw new Error('V3 冻结证据引用无效');
  }
  const suppliedIds = input.evidenceIds.map(id => text(id, 100, true));
  if (new Set(suppliedIds).size !== suppliedIds.length) throw new Error('V3 冻结证据引用重复');
  const id = `v3-freeze-${crypto.createHash('sha256').update(`${userId}\0${reportVersionKey}\0${citationKey}`).digest('hex').slice(0, 24)}`;
  const existing = store.getFrozenCitation(userId, id);
  if (existing) {
    if (existing.reportDate !== reportDate || existing.reportVersionKey !== reportVersionKey ||
      existing.citationKey !== citationKey ||
      existing.cutoff !== cutoff || existing.eventId !== eventId ||
      existing.revisionId !== revisionId || existing.analysisId !== analysisId ||
      !same(existing.evidenceIds, [...suppliedIds].sort())) {
      throw new DigestV3Conflict('V3 日报引用位已冻结且内容不同');
    }
    return { freezeId: id, status: 'existing' as const, snapshotSha256: existing.snapshotSha256 };
  }
  const { event, revision, analysis, previous, evidence, earlierEvidence } = resolveReviewedCitation(
    store, userId, { eventId, revisionId, analysisId, cutoff });
  if (revision.decidedBy !== 'user' || analysis.authorKind !== 'user') {
    throw new Error('V3 冻结仅接受人工核验记录');
  }
  const allEvidence = [...new Map([...earlierEvidence, ...evidence].map(item => [item.id, item])).values()]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const evidenceIds = allEvidence.map(item => item.id);
  if (!same([...suppliedIds].sort(), evidenceIds)) throw new Error('V3 冻结证据引用不匹配');
  const frozenFacts = (facts: DigestV3Fact[]) => facts.map(fact => ({
    factKey: fact.factKey, value: fact.value, unit: fact.unit, scope: fact.scope,
    evidenceIndexes: fact.evidenceIds.map(evidenceId => evidenceIds.indexOf(evidenceId)),
  }));
  const frozenRevision = (value: DigestV3Revision) => ({ revisionNo: value.revisionNo,
    changeKind: value.changeKind, recordedAt: value.recordedAt, facts: frozenFacts(value.facts) });
  const snapshot = {
    schemaVersion: 1,
    event: { eventType: event.eventType, subjectKey: event.subjectKey,
      occurrenceKey: event.occurrenceKey, title: event.title, lifecycle: event.lifecycle,
      createdAt: event.createdAt },
    revision: frozenRevision(revision), previousRevision: previous ? frozenRevision(previous) : null,
    analysis: { analysisKind: analysis.analysisKind, body: analysis.body,
      authorKind: analysis.authorKind, recordedAt: analysis.recordedAt },
    evidence: allEvidence.map(item => ({ url: item.url, publisherKey: item.publisherKey,
      documentType: item.documentType, language: item.language, sourceFact: item.sourceFact,
      publishedAt: item.publishedAt, publishedPrecision: item.publishedPrecision,
      retrievedAt: item.retrievedAt, independenceKey: item.independenceKey,
      reviewState: item.reviewState })),
  };
  const createdAt = clock().toISOString();
  const snapshotSha256 = frozenCitationHash(JSON.stringify(snapshot));
  store.saveFrozenCitation({ id, userId, reportDate, reportVersionKey, citationKey, cutoff, eventId, revisionId,
    analysisId, previousRevisionId: previous?.id ?? null, evidenceIds,
    snapshot, snapshotSha256, createdAt });
  return { freezeId: id, status: 'created' as const, snapshotSha256 };
}

/** Exact-ID preview only. This is not a V2 publication or a frozen V3 digest. */
export function renderLocalDigestV3Preview(store: DigestV3Store, userId: string,
  refs: { eventId: string; revisionId: string; analysisId: string; cutoff: string }): string {
  const { cutoff, event, revision, analysis, previous, evidence, earlierEvidence } =
    resolveReviewedCitation(store, userId, refs);
  const factText = (value: DigestV3Fact) => `${value.factKey}：${String(value.value)}${value.unit ? ` ${value.unit}` : ''}`;
  const previousHtml = previous ? `<div class="prior"><span>上次记录 · Revision ${previous.revisionNo}</span><p>${escaped(previous.facts.map(factText).join('；'))}</p></div>` : '';
  const links = [...earlierEvidence.map(item => ({ item: item!, label: '此前来源' })),
    ...evidence.map(item => ({ item: item!, label: '本次来源' }))]
    .map(({ item, label }, index) => `<li><span>[${index + 1}] ${label} · ${escaped(item.publisherKey)} · ${escaped(item.publishedAt ?? '发表时间未知')}<small>${escaped(item.sourceFact)}</small></span><a href="${escaped(item.url)}" target="_blank" rel="noopener noreferrer">查看来源</a></li>`).join('');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V3 本地隔离引用预览</title><style>
  :root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;background:#f5f6f4;color:#202923}main{max-width:780px;margin:auto;padding:28px 18px 70px}header{padding:16px 0 24px;border-bottom:1px solid #cad4ca}.badge{display:inline-block;border:1px solid #527966;border-radius:20px;padding:4px 10px;font-size:13px;color:#286044}h1{font-size:clamp(28px,5vw,42px);line-height:1.2;margin:18px 0 8px}.meta{color:#58665d;font-size:14px;overflow-wrap:anywhere}article{background:white;border:1px solid #d9e1d9;border-radius:16px;margin-top:24px;padding:24px}.prior{border-left:3px solid #8da89a;padding-left:16px;color:#52645a}.current{font-size:20px;line-height:1.55}ul{padding:0;list-style:none}li{display:flex;gap:14px;justify-content:space-between;border-top:1px solid #e3e9e3;padding:12px 0;overflow-wrap:anywhere}li span{min-width:0}li small{display:block;margin-top:4px;color:#59665e}a{color:#14684a;white-space:nowrap}.note{font-size:14px;color:#59665e}@media(max-width:500px){article{padding:18px}li{display:block}li a{display:block;margin-top:7px}}@media(prefers-color-scheme:dark){body{background:#151c18;color:#e9f1e9}article{background:#202a23;border-color:#425047}header,li{border-color:#425047}.meta,.note,.prior,li small{color:#bdc9bd}a,.badge{color:#94dfb9}}
  </style><main><header><span class="badge">本地隔离 · 历史来源回放</span><h1>${escaped(event.title)}</h1><div class="meta">截点 ${escaped(cutoff)} · Event ${escaped(event.id)} · Revision ${escaped(revision.id)} · Analysis ${escaped(analysis.id)}</div></header><article>${previousHtml}<div class="current"><strong>${revision.changeKind === 'initial' ? '首次记录' : '新增进展'} · Revision ${revision.revisionNo}</strong><p>${escaped(revision.facts.map(factText).join('；'))}</p></div><p>${escaped(analysis.body)}</p><h2>核对来源</h2><ul>${links}</ul><p class="note">Evidence ${escaped(revision.evidenceIds.join(', '))}。本页只展示固定引用，不进入正式日报、邮件队列或提醒。</p></article></main></html>`;
}
