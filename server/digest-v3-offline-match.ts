import crypto from 'node:crypto';
import type { DigestV3Evidence, DigestV3Fact } from './digest-v3-store.js';

/** D08 source projection. The caller must extract these bounded fields before matching. */
export type OfflineV3Source = Pick<DigestV3Evidence,
  'id' | 'url' | 'publisherKey' | 'documentType' | 'language' | 'sourceFact' |
  'publishedAt' | 'publishedPrecision' | 'independenceKey' | 'sourceDocumentKey'> & {
  event: { eventType: string; subjectKey: string; occurrenceKey: string };
  facts: Array<Pick<DigestV3Fact, 'factKey' | 'value' | 'unit' | 'scope'>>;
};

export type EventRelation = 'same_event' | 'different_event' | 'ambiguous';
export type FactChange = 'material_change' | 'no_material_change' | 'unknown' | 'not_comparable';
export type MatchDecision = 'duplicate' | 'different_event' | 'progress' | 'no_material_change' | 'ambiguous';
export type OfflineV3Suggestion = {
  eventRelation: EventRelation;
  factChange: FactChange;
  decision: MatchDecision;
  candidateEventId: string | null;
  evidenceIds: string[];
  comparedFactKeys: string[];
  addedFactKeys: string[];
  omittedFactKeys: string[];
  unknownFactKeys: string[];
  reasons: string[];
  mayReferenceSameEvent: boolean;
};

const sourceFields = new Set([
  'id', 'url', 'publisherKey', 'documentType', 'language', 'sourceFact', 'publishedAt',
  'publishedPrecision', 'independenceKey', 'sourceDocumentKey', 'event', 'facts',
]);
const eventFields = new Set(['eventType', 'subjectKey', 'occurrenceKey']);
const factFields = new Set(['factKey', 'value', 'unit', 'scope']);

function exactFields(value: unknown, allowed: Set<string>): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.has(key));
}

/** Reject oracle fields even if a caller accidentally passes a whole fixture row. */
function validateSource(value: OfflineV3Source): void {
  if (!exactFields(value, sourceFields) || !exactFields(value.event, eventFields) ||
    !Array.isArray(value.facts) || !value.facts.every(fact => exactFields(fact, factFields))) {
    throw new Error('D08 source projection contains unknown fields');
  }
  if (!value.id || !value.url || !value.sourceFact || !value.event.eventType ||
    !value.event.subjectKey || !value.event.occurrenceKey || !value.facts.every(fact =>
      !!fact.factKey && !!fact.scope && (fact.value === null ||
        ['string', 'number', 'boolean'].includes(typeof fact.value)))) {
    throw new Error('D08 source projection is incomplete');
  }
  if (value.publishedPrecision === 'unknown' ? value.publishedAt !== null
    : value.publishedPrecision === 'date'
      ? typeof value.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.publishedAt) ||
        !validDate(value.publishedAt)
      : (value.publishedPrecision !== 'minute' && value.publishedPrecision !== 'second') ||
        typeof value.publishedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.publishedAt) ||
        !validDate(value.publishedAt.slice(0, 10)) || !Number.isFinite(Date.parse(value.publishedAt))) {
    throw new Error('D08 source publication precision is invalid');
  }
}
function validDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function factIdentity(fact: OfflineV3Source['facts'][number]): string {
  return `${fact.factKey}\0${fact.scope}\0${fact.unit ?? ''}`;
}
function valueKey(value: DigestV3Fact['value']): string { return JSON.stringify(value); }
function valuesByFact(source: OfflineV3Source): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();
  for (const fact of source.facts) {
    const key = factIdentity(fact);
    const values = grouped.get(key) ?? new Set<string>();
    values.add(valueKey(fact.value));
    grouped.set(key, values);
  }
  return grouped;
}
function factName(identity: string): string { return identity.split('\0').slice(0, 2).join('/'); }
function eventId(source: OfflineV3Source): string {
  const { eventType, subjectKey, occurrenceKey } = source.event;
  return `d08-event-${crypto.createHash('sha256').update(JSON.stringify([eventType, subjectKey, occurrenceKey])).digest('hex').slice(0, 20)}`;
}
function definitelyLater(earlier: OfflineV3Source, later: OfflineV3Source): boolean {
  if (!earlier.publishedAt || !later.publishedAt) return false;
  if (earlier.publishedPrecision === 'date' && later.publishedPrecision === 'date') {
    return earlier.publishedAt < later.publishedAt;
  }
  // A date-only source has no timezone or time of day. Mixed precision is not enough to order updates.
  if (earlier.publishedPrecision === 'date' || later.publishedPrecision === 'date') return false;
  const endOfEarlier = Date.parse(earlier.publishedAt) +
    (earlier.publishedPrecision === 'minute' ? 59_999 : 999);
  return endOfEarlier < Date.parse(later.publishedAt);
}
function canonicalOrder(a: OfflineV3Source, b: OfflineV3Source): [OfflineV3Source, OfflineV3Source] {
  if (definitelyLater(a, b)) return [a, b];
  if (definitelyLater(b, a)) return [b, a];
  const key = (source: OfflineV3Source) => `${source.url}\0${source.id}`;
  return key(a) <= key(b) ? [a, b] : [b, a];
}

/** Pure, order-independent suggestion. It does not read or mutate activity.db. */
export function suggestOfflineV3Match(first: OfflineV3Source, second: OfflineV3Source): OfflineV3Suggestion {
  validateSource(first);
  validateSource(second);
  const [earlier, later] = canonicalOrder(first, second);
  const evidenceIds = [...new Set([first.id, second.id])].sort();
  const reasons: string[] = [];
  const sameType = earlier.event.eventType === later.event.eventType;
  const sameSubject = earlier.event.subjectKey === later.event.subjectKey;
  const sameOccurrence = earlier.event.occurrenceKey === later.event.occurrenceKey;
  let eventRelation: EventRelation;
  if (sameType && sameSubject && sameOccurrence) {
    eventRelation = 'same_event';
    reasons.push('事件类型、对象和发生标识一致');
  } else if (sameType && (!sameSubject || !sameOccurrence)) {
    eventRelation = 'different_event';
    reasons.push('对象或发生标识不同；同值或相似标题不能合并事件');
  } else {
    eventRelation = 'ambiguous';
    reasons.push('事件类型与身份字段不足以安全关联');
  }
  const sameDocument = !!earlier.sourceDocumentKey &&
    earlier.sourceDocumentKey === later.sourceDocumentKey;
  if (sameDocument) reasons.push('同一发布物或译文链，只计一条独立来源');
  else if (earlier.independenceKey === later.independenceKey) reasons.push('来源独立性键相同，不计双重确认');

  const before = valuesByFact(earlier);
  const after = valuesByFact(later);
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  const known = (values: Set<string> | undefined) => !!values && values.size === 1 && !values.has('null');
  const compared = keys.filter(key => known(before.get(key)) && known(after.get(key)));
  const added = keys.filter(key => !before.has(key) && known(after.get(key)));
  const omitted = keys.filter(key => known(before.get(key)) && !after.has(key));
  const unknown = keys.filter(key => before.get(key)?.has('null') || after.get(key)?.has('null'));
  const internalConflict = [...before.values(), ...after.values()].some(values =>
    [...values].filter(value => value !== 'null').length > 1);
  const changed = compared.filter(key => {
    const left = before.get(key)!;
    const right = after.get(key)!;
    return [...left][0] !== [...right][0];
  });
  const stageOrder: Record<string, number> = {
    initial: 1, launched: 2, progress: 3, orbit: 3, docked: 3, splashdown: 4, landed: 4,
  };
  const stageProgress = changed.length > 0 && changed.every(key => {
    const [factKey] = key.split('\0');
    if (factKey !== 'flight_phase' && factKey !== 'state') return false;
    const left = [...before.get(key)!];
    const right = [...after.get(key)!];
    const oldStage = stageOrder[JSON.parse(left[0]) as string];
    const newStage = stageOrder[JSON.parse(right[0]) as string];
    return !!oldStage && !!newStage && newStage > oldStage;
  });
  const completeEqual = compared.length > 0 && changed.length === 0 &&
    added.length === 0 && omitted.length === 0 && unknown.length === 0 && !internalConflict;
  let factChange: FactChange = 'unknown';
  if (eventRelation === 'different_event') {
    if (internalConflict) factChange = 'unknown';
    else if (changed.length) factChange = 'material_change';
    else if (compared.length && unknown.length === 0)
      factChange = 'no_material_change';
    else if (unknown.length) factChange = 'unknown';
    else factChange = 'not_comparable';
    if (factChange === 'no_material_change') reasons.push('仅相同指标、范围与单位的值未变；会议仍各自成事件');
  } else if (eventRelation === 'same_event') {
    if (internalConflict || (sameDocument && changed.length)) {
      reasons.push('来源事实互相冲突，需人工复核');
    } else if (sameDocument && completeEqual) {
      factChange = 'no_material_change';
      reasons.push('发布物身份与有界事实一致，译文不构成新进展');
    } else if (earlier.event.eventType === 'mission' && !sameDocument &&
      definitelyLater(earlier, later) && (stageProgress || (!changed.length && added.length > 0))) {
      factChange = 'material_change';
      reasons.push('同一长程任务在较后来源中出现新的阶段事实');
    } else if (completeEqual && earlier.sourceFact === later.sourceFact) {
      factChange = 'no_material_change';
      reasons.push('同一事件的有界来源事实完全相同');
    } else {
      reasons.push('文档覆盖范围或事实矛盾不足以判定实质变化');
    }
  }
  if (added.length) reasons.push(`较后来源新增的事实：${added.map(factName).join('、')}`);
  if (omitted.length) reasons.push(`较后来源省略的旧事实：${omitted.map(factName).join('、')}`);
  if (unknown.length) reasons.push(`值未知、不能用于无变化结论：${unknown.map(factName).join('、')}`);
  if (!sameDocument && eventRelation === 'same_event' && !definitelyLater(earlier, later) &&
    (added.length || changed.length)) reasons.push('来源时间精度不足以证明先后进展');
  const decision: MatchDecision = eventRelation === 'same_event'
    ? factChange === 'material_change' ? 'progress'
      : factChange === 'no_material_change' ? (sameDocument ? 'duplicate' : 'no_material_change')
        : 'ambiguous'
    : eventRelation === 'different_event'
      ? factChange === 'no_material_change' ? 'no_material_change' : 'different_event'
      : 'ambiguous';
  return {
    eventRelation, factChange, decision,
    candidateEventId: eventRelation === 'same_event' ? eventId(earlier) : null,
    evidenceIds, comparedFactKeys: compared.map(factName),
    addedFactKeys: added.map(factName), omittedFactKeys: omitted.map(factName),
    unknownFactKeys: unknown.map(factName),
    reasons, mayReferenceSameEvent: eventRelation === 'same_event' && decision !== 'ambiguous',
  };
}
