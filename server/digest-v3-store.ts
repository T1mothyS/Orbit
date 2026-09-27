import crypto from 'node:crypto';
import type { Database } from 'sql.js';
import { publicDigestUrl } from './digest-v2-contract.js';
import { assertPersistenceReady } from './persistence.js';

export interface DigestV3Evidence {
  id: string; userId: string; url: string; publisherKey: string; documentType: string;
  language: string; sourceFact: string; publishedAt: string | null;
  publishedPrecision: 'date' | 'minute' | 'second' | 'unknown'; retrievedAt: string;
  independenceKey: string; reviewState: 'verified' | 'needs_review' | 'rejected';
  sourceDocumentKey?: string | null; relatedEvidenceId?: string | null;
  relation?: 'translation' | 'reprint' | 'update' | null;
  supersedesEvidenceId?: string | null; linkedRevisionId?: string | null;
}

export interface DigestV3Fact {
  factKey: string; value: string | number | boolean | null; unit: string | null;
  scope: string; evidenceIds: string[];
}

export interface DigestV3Event {
  id: string; userId: string; eventType: string; subjectKey: string;
  occurrenceKey: string; title: string; lifecycle: 'active' | 'merged' | 'retracted';
  currentRevisionId: string; createdAt: string; mergedIntoEventId?: string | null;
}

export interface DigestV3Revision {
  id: string; userId: string; eventId: string; revisionNo: number;
  previousRevisionId: string | null;
  changeKind: 'initial' | 'progress' | 'correction' | 'no_material_change' | 'retraction';
  facts: DigestV3Fact[]; evidenceIds: string[]; recordedAt: string;
  occurredAt?: string | null;
  occurredPrecision?: 'date' | 'minute' | 'second' | 'unknown' | null;
  reason?: string | null; decidedBy?: 'system' | 'user' | null;
}

export interface DigestV3Analysis {
  id: string; userId: string; eventRevisionId: string; evidenceIds: string[];
  comparedRevisionIds?: string[];
  analysisKind: 'interpretation' | 'change_assessment' | 'hypothesis';
  body: string; authorKind: 'ai' | 'user'; recordedAt: string;
  factKey?: string | null; scope?: string | null;
  check?: 'complete' | 'incomplete' | null;
  assessment?: 'material' | 'no_material_change' | 'unknown' | null;
  runId?: string | null; modelId?: string | null; promptVersion?: string | null;
  supersedesAnalysisId?: string | null;
}

export class DigestV3Conflict extends Error {}

export interface DigestV3FrozenCitation {
  id: string; userId: string; reportDate: string; reportVersionKey: string; citationKey: string; cutoff: string;
  eventId: string; revisionId: string; analysisId: string; previousRevisionId: string | null;
  evidenceIds: string[]; snapshot: Record<string, unknown>; snapshotSha256: string; createdAt: string;
}

export function frozenCitationHash(json: string): string {
  return crypto.createHash('sha256').update(json).digest('hex');
}
function sameStrings(a: string[], b: string[]): boolean { return JSON.stringify(a) === JSON.stringify(b); }

function frozenSnapshotValid(value: unknown, evidenceCount: number): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, any>;
  const record = (item: unknown): item is Record<string, any> =>
    !!item && typeof item === 'object' && !Array.isArray(item);
  const revision = (item: unknown) => record(item) && Number.isSafeInteger(item.revisionNo) &&
    typeof item.changeKind === 'string' && typeof item.recordedAt === 'string' &&
    Array.isArray(item.facts) && item.facts.every((fact: unknown) => record(fact) &&
      typeof fact.factKey === 'string' && typeof fact.scope === 'string' &&
      Array.isArray(fact.evidenceIndexes) && fact.evidenceIndexes.length > 0 &&
      fact.evidenceIndexes.every((index: unknown) => Number.isSafeInteger(index) &&
        Number(index) >= 0 && Number(index) < evidenceCount));
  return evidenceCount > 0 && evidenceCount <= 100 && snapshot.schemaVersion === 1 && record(snapshot.event) &&
    ['eventType', 'subjectKey', 'occurrenceKey', 'title', 'createdAt'].every(key =>
      typeof snapshot.event[key] === 'string') && snapshot.event.lifecycle === 'active' &&
    revision(snapshot.revision) && (snapshot.previousRevision === null || revision(snapshot.previousRevision)) &&
    record(snapshot.analysis) && typeof snapshot.analysis.body === 'string' &&
    snapshot.analysis.body.length <= 1500 &&
    typeof snapshot.analysis.recordedAt === 'string' &&
    Array.isArray(snapshot.evidence) && snapshot.evidence.length === evidenceCount &&
    snapshot.evidence.every((item: unknown) => record(item) &&
      ['url', 'publisherKey', 'documentType', 'language', 'sourceFact', 'retrievedAt', 'independenceKey']
        .every(key => typeof item[key] === 'string') &&
      item.url.length <= 2048 && publicDigestUrl(item.url) && item.sourceFact.length <= 1000 &&
      item.reviewState === 'verified' &&
      (item.publishedAt === null || typeof item.publishedAt === 'string'));
}

const FROZEN_BACKUP_TABLE = { key: 'digestV3FrozenCitations', table: 'digest_v3_frozen_citations',
  columns: ['user_id', 'id', 'report_date', 'report_version_key', 'citation_key', 'cutoff', 'event_id', 'revision_id',
    'analysis_id', 'previous_revision_id', 'evidence_ids_json', 'snapshot_json', 'snapshot_sha256', 'created_at'],
  identity: ['id'] } as const;

const CORE_BACKUP_TABLES = [
  { key: 'digestV3Events', table: 'digest_v3_events', columns: ['user_id', 'id', 'event_type', 'subject_key', 'occurrence_key', 'title', 'lifecycle', 'current_revision_id', 'merged_into_event_id', 'created_at'], identity: ['id'] },
  { key: 'digestV3Revisions', table: 'digest_v3_revisions', columns: ['user_id', 'id', 'event_id', 'revision_no', 'previous_revision_id', 'change_kind', 'facts_json', 'recorded_at', 'occurred_at', 'occurred_precision', 'reason', 'decided_by'], identity: ['id'] },
  { key: 'digestV3Evidence', table: 'digest_v3_evidence', columns: ['user_id', 'id', 'url', 'publisher_key', 'document_type', 'language', 'source_fact', 'published_at', 'published_precision', 'retrieved_at', 'independence_key', 'review_state', 'source_document_key', 'related_evidence_id', 'relation', 'supersedes_evidence_id', 'linked_revision_id'], identity: ['id'] },
  { key: 'digestV3Analyses', table: 'digest_v3_analyses', columns: ['user_id', 'id', 'event_revision_id', 'analysis_kind', 'body', 'author_kind', 'recorded_at', 'fact_key', 'scope', 'check_state', 'assessment', 'run_id', 'model_id', 'prompt_version', 'supersedes_analysis_id'], identity: ['id'] },
  { key: 'digestV3RevisionEvidence', table: 'digest_v3_revision_evidence', columns: ['user_id', 'revision_id', 'evidence_id'], identity: ['revision_id', 'evidence_id'] },
  { key: 'digestV3AnalysisEvidence', table: 'digest_v3_analysis_evidence', columns: ['user_id', 'analysis_id', 'evidence_id'], identity: ['analysis_id', 'evidence_id'] },
  { key: 'digestV3AnalysisComparisons', table: 'digest_v3_analysis_comparisons', columns: ['user_id', 'analysis_id', 'revision_id'], identity: ['analysis_id', 'revision_id'] },
] as const;
const BACKUP_TABLES = [...CORE_BACKUP_TABLES, FROZEN_BACKUP_TABLE] as const;

type BackupRows = Record<string, Array<Record<string, any>>>;

/** Old user backups have no V3 keys; pre-D09 V3 backups have seven arrays. */
export function validateDigestV3Backup(data: Record<string, unknown>): BackupRows | null {
  const present = CORE_BACKUP_TABLES.filter(spec => Object.hasOwn(data, spec.key));
  if (!present.length && !Object.hasOwn(data, FROZEN_BACKUP_TABLE.key)) return null;
  if (present.length !== CORE_BACKUP_TABLES.length) throw new Error('V3 事件备份缺少关联表');
  const rows: BackupRows = {};
  const sourceUsers = new Set<string>();
  for (const spec of BACKUP_TABLES) {
    const value = spec === FROZEN_BACKUP_TABLE && !Object.hasOwn(data, spec.key) ? [] : data[spec.key];
    if (!Array.isArray(value) || value.length > 100_000) throw new Error('V3 事件备份数量无效');
    const seen = new Set<string>();
    rows[spec.key] = value.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
        spec.columns.some(column => !Object.hasOwn(item, column)) ||
        spec.identity.some(column => typeof item[column] !== 'string' || !item[column]) ||
        typeof item.user_id !== 'string' || !item.user_id) {
        throw new Error('V3 事件备份记录无效');
      }
      sourceUsers.add(item.user_id);
      const key = spec.identity.map(column => item[column]).join('\0');
      if (seen.has(key)) throw new Error('V3 事件备份 ID 重复');
      seen.add(key);
      return item;
    });
  }
  if (sourceUsers.size > 1) throw new Error('V3 事件备份混合了多个账号');
  const events = new Map(rows.digestV3Events.map(row => [row.id, row]));
  const revisions = new Map(rows.digestV3Revisions.map(row => [row.id, row]));
  const evidence = new Map(rows.digestV3Evidence.map(row => [row.id, row]));
  const analyses = new Map(rows.digestV3Analyses.map(row => [row.id, row]));
  const requireRef = (map: Map<string, any>, id: unknown) => {
    if (id != null && (typeof id !== 'string' || !map.has(id))) throw new Error('V3 事件备份引用断裂');
  };
  for (const row of events.values()) {
    const current = revisions.get(row.current_revision_id);
    if (!current || current.event_id !== row.id) throw new Error('V3 事件备份当前修订断裂');
    requireRef(events, row.merged_into_event_id);
  }
  const revisionEvidence = new Set(rows.digestV3RevisionEvidence.map(row => `${row.revision_id}\0${row.evidence_id}`));
  for (const row of revisions.values()) {
    if (!events.has(row.event_id)) throw new Error('V3 事件备份修订断裂');
    requireRef(revisions, row.previous_revision_id);
    if (row.previous_revision_id && revisions.get(row.previous_revision_id)?.event_id !== row.event_id) throw new Error('V3 事件备份前版跨事件');
    let facts: unknown;
    try { facts = JSON.parse(row.facts_json); } catch { throw new Error('V3 事件备份事实无效'); }
    if (!Array.isArray(facts) || facts.some(fact => !fact || !Array.isArray(fact.evidenceIds) ||
      fact.evidenceIds.some((id: unknown) => !evidence.has(String(id)) || !revisionEvidence.has(`${row.id}\0${id}`)))) {
      throw new Error('V3 事件备份事实引用断裂');
    }
  }
  for (const row of evidence.values()) {
    requireRef(evidence, row.related_evidence_id);
    requireRef(evidence, row.supersedes_evidence_id);
    requireRef(revisions, row.linked_revision_id);
  }
  for (const row of analyses.values()) {
    if (!revisions.has(row.event_revision_id)) throw new Error('V3 事件备份分析断裂');
    requireRef(analyses, row.supersedes_analysis_id);
  }
  for (const row of rows.digestV3RevisionEvidence) { requireRef(revisions, row.revision_id); requireRef(evidence, row.evidence_id); }
  for (const row of rows.digestV3AnalysisEvidence) { requireRef(analyses, row.analysis_id); requireRef(evidence, row.evidence_id); }
  for (const row of rows.digestV3AnalysisComparisons) { requireRef(analyses, row.analysis_id); requireRef(revisions, row.revision_id); }
  for (const row of rows.digestV3FrozenCitations) {
    const revision = revisions.get(row.revision_id);
    const analysis = analyses.get(row.analysis_id);
    const previous = row.previous_revision_id == null ? null : revisions.get(row.previous_revision_id);
    if (!events.has(row.event_id) || !revision || revision.event_id !== row.event_id ||
      !analysis || analysis.event_revision_id !== row.revision_id ||
      (row.previous_revision_id != null && (!previous || previous.event_id !== row.event_id)) ||
      revision.previous_revision_id !== row.previous_revision_id ||
      typeof row.report_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.report_date) ||
      typeof row.report_version_key !== 'string' || !row.report_version_key ||
      typeof row.citation_key !== 'string' || !row.citation_key ||
      typeof row.cutoff !== 'string' || !Number.isFinite(Date.parse(row.cutoff)) ||
      typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) ||
      typeof row.snapshot_json !== 'string' ||
      row.snapshot_sha256 !== frozenCitationHash(row.snapshot_json)) {
      throw new Error('V3 冻结引用备份无效');
    }
    let ids: unknown;
    let snapshot: unknown;
    try { ids = JSON.parse(row.evidence_ids_json); snapshot = JSON.parse(row.snapshot_json); }
    catch { throw new Error('V3 冻结引用备份无效'); }
    const expected = [...new Set([
      ...rows.digestV3RevisionEvidence.filter(link => link.revision_id === row.revision_id ||
        link.revision_id === row.previous_revision_id).map(link => link.evidence_id),
    ])].sort();
    if (!Array.isArray(ids) || ids.length !== expected.length ||
      ids.some((id, index) => id !== expected[index] || !evidence.has(id)) ||
      !frozenSnapshotValid(snapshot, ids.length) ||
      (row.previous_revision_id !== null) !== ((snapshot as Record<string, unknown>).previousRevision !== null)) {
      throw new Error('V3 冻结引用备份无效');
    }
  }
  return rows;
}

/** An additive migration inside the existing activity.db. No V2 rows are read or rewritten. */
export function migrateDigestV3Schema(db: Database): void {
  db.run('BEGIN TRANSACTION');
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS digest_v3_events (
        user_id TEXT NOT NULL, id TEXT NOT NULL, event_type TEXT NOT NULL,
        subject_key TEXT NOT NULL, occurrence_key TEXT NOT NULL, title TEXT NOT NULL,
        lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'merged', 'retracted')),
        current_revision_id TEXT NOT NULL, merged_into_event_id TEXT, created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, id),
        FOREIGN KEY (user_id, merged_into_event_id) REFERENCES digest_v3_events(user_id, id),
        FOREIGN KEY (user_id, id, current_revision_id)
          REFERENCES digest_v3_revisions(user_id, event_id, id) DEFERRABLE INITIALLY DEFERRED
      );
      CREATE INDEX IF NOT EXISTS idx_digest_v3_events_identity
        ON digest_v3_events(user_id, event_type, subject_key, occurrence_key);
      CREATE TABLE IF NOT EXISTS digest_v3_revisions (
        user_id TEXT NOT NULL, id TEXT NOT NULL, event_id TEXT NOT NULL,
        revision_no INTEGER NOT NULL CHECK (revision_no > 0), previous_revision_id TEXT,
        change_kind TEXT NOT NULL CHECK (change_kind IN ('initial', 'progress', 'correction', 'no_material_change', 'retraction')),
        facts_json TEXT NOT NULL, recorded_at TEXT NOT NULL,
        occurred_at TEXT, occurred_precision TEXT CHECK (occurred_precision IN ('date', 'minute', 'second', 'unknown')),
        reason TEXT, decided_by TEXT CHECK (decided_by IN ('system', 'user')),
        PRIMARY KEY (user_id, id), UNIQUE (user_id, event_id, id), UNIQUE (user_id, event_id, revision_no),
        FOREIGN KEY (user_id, event_id) REFERENCES digest_v3_events(user_id, id),
        FOREIGN KEY (user_id, event_id, previous_revision_id)
          REFERENCES digest_v3_revisions(user_id, event_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_digest_v3_revisions_event
        ON digest_v3_revisions(user_id, event_id, revision_no DESC);
      CREATE TABLE IF NOT EXISTS digest_v3_evidence (
        user_id TEXT NOT NULL, id TEXT NOT NULL, url TEXT NOT NULL,
        publisher_key TEXT NOT NULL, document_type TEXT NOT NULL, language TEXT NOT NULL,
        source_fact TEXT NOT NULL, published_at TEXT,
        published_precision TEXT NOT NULL CHECK (published_precision IN ('date', 'minute', 'second', 'unknown')),
        retrieved_at TEXT NOT NULL, independence_key TEXT NOT NULL,
        review_state TEXT NOT NULL CHECK (review_state IN ('verified', 'needs_review', 'rejected')),
        source_document_key TEXT, related_evidence_id TEXT,
        relation TEXT CHECK (relation IN ('translation', 'reprint', 'update')),
        supersedes_evidence_id TEXT, linked_revision_id TEXT,
        PRIMARY KEY (user_id, id),
        CHECK ((published_at IS NULL) = (published_precision = 'unknown')),
        CHECK ((related_evidence_id IS NULL) = (relation IS NULL)),
        FOREIGN KEY (user_id, related_evidence_id) REFERENCES digest_v3_evidence(user_id, id),
        FOREIGN KEY (user_id, supersedes_evidence_id) REFERENCES digest_v3_evidence(user_id, id),
        FOREIGN KEY (user_id, linked_revision_id) REFERENCES digest_v3_revisions(user_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_digest_v3_evidence_published
        ON digest_v3_evidence(user_id, published_at);
      CREATE TABLE IF NOT EXISTS digest_v3_revision_evidence (
        user_id TEXT NOT NULL, revision_id TEXT NOT NULL, evidence_id TEXT NOT NULL,
        PRIMARY KEY (user_id, revision_id, evidence_id),
        FOREIGN KEY (user_id, revision_id) REFERENCES digest_v3_revisions(user_id, id),
        FOREIGN KEY (user_id, evidence_id) REFERENCES digest_v3_evidence(user_id, id)
      );
      CREATE TABLE IF NOT EXISTS digest_v3_analyses (
        user_id TEXT NOT NULL, id TEXT NOT NULL, event_revision_id TEXT NOT NULL,
        analysis_kind TEXT NOT NULL CHECK (analysis_kind IN ('interpretation', 'change_assessment', 'hypothesis')),
        body TEXT NOT NULL, author_kind TEXT NOT NULL CHECK (author_kind IN ('ai', 'user')),
        recorded_at TEXT NOT NULL, fact_key TEXT, scope TEXT,
        check_state TEXT CHECK (check_state IN ('complete', 'incomplete')),
        assessment TEXT CHECK (assessment IN ('material', 'no_material_change', 'unknown')),
        run_id TEXT, model_id TEXT, prompt_version TEXT, supersedes_analysis_id TEXT,
        PRIMARY KEY (user_id, id),
        CHECK (analysis_kind <> 'change_assessment' OR
          (fact_key IS NOT NULL AND scope IS NOT NULL AND check_state IS NOT NULL AND assessment IS NOT NULL)),
        CHECK (assessment <> 'no_material_change' OR check_state = 'complete'),
        FOREIGN KEY (user_id, event_revision_id) REFERENCES digest_v3_revisions(user_id, id),
        FOREIGN KEY (user_id, supersedes_analysis_id) REFERENCES digest_v3_analyses(user_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_digest_v3_analyses_revision
        ON digest_v3_analyses(user_id, event_revision_id, recorded_at DESC);
      CREATE TABLE IF NOT EXISTS digest_v3_analysis_evidence (
        user_id TEXT NOT NULL, analysis_id TEXT NOT NULL, evidence_id TEXT NOT NULL,
        PRIMARY KEY (user_id, analysis_id, evidence_id),
        FOREIGN KEY (user_id, analysis_id) REFERENCES digest_v3_analyses(user_id, id),
        FOREIGN KEY (user_id, evidence_id) REFERENCES digest_v3_evidence(user_id, id)
      );
      CREATE TABLE IF NOT EXISTS digest_v3_analysis_comparisons (
        user_id TEXT NOT NULL, analysis_id TEXT NOT NULL, revision_id TEXT NOT NULL,
        PRIMARY KEY (user_id, analysis_id, revision_id),
        FOREIGN KEY (user_id, analysis_id) REFERENCES digest_v3_analyses(user_id, id),
        FOREIGN KEY (user_id, revision_id) REFERENCES digest_v3_revisions(user_id, id)
      );
      CREATE TABLE IF NOT EXISTS digest_v3_frozen_citations (
        user_id TEXT NOT NULL, id TEXT NOT NULL, report_date TEXT NOT NULL, report_version_key TEXT NOT NULL,
        citation_key TEXT NOT NULL, cutoff TEXT NOT NULL, event_id TEXT NOT NULL,
        revision_id TEXT NOT NULL, analysis_id TEXT NOT NULL, previous_revision_id TEXT,
        evidence_ids_json TEXT NOT NULL, snapshot_json TEXT NOT NULL,
        snapshot_sha256 TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, id), UNIQUE (user_id, report_version_key, citation_key),
        FOREIGN KEY (user_id, event_id) REFERENCES digest_v3_events(user_id, id),
        FOREIGN KEY (user_id, revision_id) REFERENCES digest_v3_revisions(user_id, id),
        FOREIGN KEY (user_id, analysis_id) REFERENCES digest_v3_analyses(user_id, id),
        FOREIGN KEY (user_id, previous_revision_id) REFERENCES digest_v3_revisions(user_id, id)
      );
      CREATE TRIGGER IF NOT EXISTS digest_v3_frozen_citation_immutable BEFORE UPDATE ON digest_v3_frozen_citations
        BEGIN SELECT RAISE(ABORT, 'digest_v3_frozen_citation_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS digest_v3_revision_immutable BEFORE UPDATE ON digest_v3_revisions
        BEGIN SELECT RAISE(ABORT, 'digest_v3_revision_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS digest_v3_evidence_immutable BEFORE UPDATE ON digest_v3_evidence
        BEGIN SELECT RAISE(ABORT, 'digest_v3_evidence_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS digest_v3_analysis_immutable BEFORE UPDATE ON digest_v3_analyses
        BEGIN SELECT RAISE(ABORT, 'digest_v3_analysis_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS digest_v3_event_identity_immutable BEFORE UPDATE OF user_id, id ON digest_v3_events
        BEGIN SELECT RAISE(ABORT, 'digest_v3_event_identity_immutable'); END;
      INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('digest_v3', '2');
    `);
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  }
}

function queryAll<T>(db: Database, sql: string, params: unknown[]): T[] {
  assertPersistenceReady();
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const rows: T[] = [];
    while (statement.step()) rows.push(statement.getAsObject() as T);
    return rows;
  } finally { statement.free(); }
}

function queryOne<T>(db: Database, sql: string, params: unknown[]): T | null {
  return queryAll<T>(db, sql, params)[0] ?? null;
}

export class DigestV3Store {
  constructor(private readonly getDb: () => Database, private readonly persist: () => void) {}

  private transaction<T>(action: (db: Database) => T): T {
    assertPersistenceReady();
    const db = this.getDb();
    db.run('BEGIN TRANSACTION');
    let committed = false;
    try {
      const result = action(db);
      db.run('COMMIT');
      committed = true;
      this.persist();
      return result;
    } catch (error) {
      if (!committed) try { db.run('ROLLBACK'); } catch {}
      throw error;
    }
  }

  addEvidence(value: DigestV3Evidence): void {
    this.transaction(db => this.insertEvidence(db, value));
  }

  private insertEvidence(db: Database, value: DigestV3Evidence): void {
    db.run(`
      INSERT INTO digest_v3_evidence
        (user_id, id, url, publisher_key, document_type, language, source_fact,
         published_at, published_precision, retrieved_at, independence_key, review_state,
         source_document_key, related_evidence_id, relation, supersedes_evidence_id, linked_revision_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [value.userId, value.id, value.url, value.publisherKey, value.documentType, value.language,
      value.sourceFact, value.publishedAt, value.publishedPrecision, value.retrievedAt,
      value.independenceKey, value.reviewState, value.sourceDocumentKey ?? null,
      value.relatedEvidenceId ?? null, value.relation ?? null, value.supersedesEvidenceId ?? null,
      value.linkedRevisionId ?? null]);
  }

  getEvidence(userId: string, id: string): DigestV3Evidence | null {
    const row = queryOne<Record<string, any>>(this.getDb(),
      'SELECT * FROM digest_v3_evidence WHERE user_id = ? AND id = ?', [userId, id]);
    return row && {
      id: row.id, userId: row.user_id, url: row.url, publisherKey: row.publisher_key,
      documentType: row.document_type, language: row.language, sourceFact: row.source_fact,
      publishedAt: row.published_at, publishedPrecision: row.published_precision,
      retrievedAt: row.retrieved_at, independenceKey: row.independence_key,
      reviewState: row.review_state, sourceDocumentKey: row.source_document_key,
      relatedEvidenceId: row.related_evidence_id, relation: row.relation,
      supersedesEvidenceId: row.supersedes_evidence_id, linkedRevisionId: row.linked_revision_id,
    };
  }

  createEvent(event: DigestV3Event, first: DigestV3Revision): void {
    if (event.userId !== first.userId || event.id !== first.eventId ||
      event.currentRevisionId !== first.id || first.revisionNo !== 1 ||
      first.previousRevisionId !== null || first.changeKind !== 'initial' || event.lifecycle !== 'active') {
      throw new Error('V3 初始事件与修订不一致');
    }
    this.transaction(db => {
      this.insertEvent(db, event);
      this.insertRevision(db, first);
    });
  }

  private insertEvent(db: Database, event: DigestV3Event): void {
    db.run(`INSERT INTO digest_v3_events
      (user_id, id, event_type, subject_key, occurrence_key, title, lifecycle,
       current_revision_id, merged_into_event_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [event.userId, event.id, event.eventType, event.subjectKey, event.occurrenceKey,
      event.title, event.lifecycle, event.currentRevisionId, event.mergedIntoEventId ?? null, event.createdAt]);
  }

  appendRevision(value: DigestV3Revision): void {
    this.transaction(db => {
      const current = queryOne<{ current_revision_id: string; revision_no: number }>(db,
        `SELECT e.current_revision_id, r.revision_no FROM digest_v3_events e
         JOIN digest_v3_revisions r ON r.user_id = e.user_id AND r.id = e.current_revision_id
         WHERE e.user_id = ? AND e.id = ? AND e.lifecycle = 'active'`, [value.userId, value.eventId]);
      if (!current || current.current_revision_id !== value.previousRevisionId ||
        value.revisionNo !== current.revision_no + 1 || value.changeKind === 'initial') {
        throw new DigestV3Conflict('V3 修订版本冲突');
      }
      this.insertRevision(db, value);
      db.run('UPDATE digest_v3_events SET current_revision_id = ? WHERE user_id = ? AND id = ?',
        [value.id, value.userId, value.eventId]);
    });
  }

  private insertRevision(db: Database, value: DigestV3Revision): void {
    const evidenceIds = [...new Set(value.evidenceIds)];
    if (evidenceIds.length !== value.evidenceIds.length ||
      value.facts.some(fact => fact.evidenceIds.some(id => !evidenceIds.includes(id)))) {
      throw new Error('V3 修订证据引用不一致');
    }
    db.run(`INSERT INTO digest_v3_revisions
      (user_id, id, event_id, revision_no, previous_revision_id, change_kind,
       facts_json, recorded_at, occurred_at, occurred_precision, reason, decided_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [value.userId, value.id, value.eventId, value.revisionNo, value.previousRevisionId,
      value.changeKind, JSON.stringify(value.facts), value.recordedAt,
      value.occurredAt ?? null, value.occurredPrecision ?? null,
      value.reason ?? null, value.decidedBy ?? null]);
    for (const evidenceId of evidenceIds) db.run(
      'INSERT INTO digest_v3_revision_evidence (user_id, revision_id, evidence_id) VALUES (?, ?, ?)',
      [value.userId, value.id, evidenceId]);
  }

  getEvent(userId: string, id: string): DigestV3Event | null {
    const row = queryOne<Record<string, any>>(this.getDb(),
      'SELECT * FROM digest_v3_events WHERE user_id = ? AND id = ?', [userId, id]);
    return row && { id: row.id, userId: row.user_id, eventType: row.event_type,
      subjectKey: row.subject_key, occurrenceKey: row.occurrence_key, title: row.title,
      lifecycle: row.lifecycle, currentRevisionId: row.current_revision_id,
      mergedIntoEventId: row.merged_into_event_id, createdAt: row.created_at };
  }

  listEventsAtCutoff(userId: string, cutoff: string, limit: number, offset: number) {
    const db = this.getDb();
    const where = `e.user_id = ? AND e.created_at <= ? AND EXISTS (
      SELECT 1 FROM digest_v3_revisions r WHERE r.user_id = e.user_id
      AND r.event_id = e.id AND r.recorded_at <= ?)`;
    const total = queryOne<{ count: number }>(db,
      `SELECT COUNT(*) AS count FROM digest_v3_events e WHERE ${where}`, [userId, cutoff, cutoff])!.count;
    const rows = queryAll<Record<string, any>>(db,
      `SELECT e.id, e.event_type, e.subject_key, e.occurrence_key, e.title, e.created_at,
        (SELECT r.id FROM digest_v3_revisions r WHERE r.user_id = e.user_id
          AND r.event_id = e.id AND r.recorded_at <= ? ORDER BY r.revision_no DESC LIMIT 1) AS latest_revision_id
       FROM digest_v3_events e WHERE ${where}
       ORDER BY e.created_at DESC, e.id LIMIT ? OFFSET ?`,
      [cutoff, userId, cutoff, cutoff, limit, offset]);
    return { total, events: rows.map(row => ({ id: row.id, eventType: row.event_type,
      subjectKey: row.subject_key, occurrenceKey: row.occurrence_key, title: row.title,
      createdAt: row.created_at, latestRevisionIdAtCutoff: row.latest_revision_id })) };
  }

  /** Read the account history visible at a cutoff without exposing a later current pointer. */
  getEventHistory(userId: string, eventId: string, cutoff: string, limit: number, offset: number) {
    const db = this.getDb();
    const event = this.getEvent(userId, eventId);
    if (!event || event.createdAt > cutoff) return null;
    const latest = queryOne<{ id: string }>(db,
      `SELECT id FROM digest_v3_revisions WHERE user_id = ? AND event_id = ? AND recorded_at <= ?
       ORDER BY revision_no DESC LIMIT 1`, [userId, eventId, cutoff]);
    if (!latest) return null;
    const count = queryOne<{ count: number }>(db,
      `SELECT COUNT(*) AS count FROM digest_v3_revisions
       WHERE user_id = ? AND event_id = ? AND recorded_at <= ?`, [userId, eventId, cutoff])!;
    const rows = queryAll<{ id: string }>(db,
      `SELECT id FROM digest_v3_revisions WHERE user_id = ? AND event_id = ? AND recorded_at <= ?
       ORDER BY revision_no DESC LIMIT ? OFFSET ?`, [userId, eventId, cutoff, limit, offset]);
    const history = rows.map(row => {
      const revision = this.getRevision(userId, row.id)!;
      const evidence = revision.evidenceIds.map(id => {
        const item = this.getEvidence(userId, id);
        if (!item || item.retrievedAt > cutoff) throw new Error('V3 历史证据引用无效');
        return item;
      });
      const analysisIds = queryAll<{ id: string }>(db,
        `SELECT id FROM digest_v3_analyses WHERE user_id = ? AND event_revision_id = ? AND recorded_at <= ?
         ORDER BY recorded_at, id`, [userId, revision.id, cutoff]);
      const analyses = analysisIds.map(item => this.getAnalysis(userId, item.id)!);
      return { revision, evidence, analyses };
    });
    const identity = { id: event.id, eventType: event.eventType, subjectKey: event.subjectKey,
      occurrenceKey: event.occurrenceKey, title: event.title, createdAt: event.createdAt };
    return { event: identity, latestRevisionIdAtCutoff: latest.id, total: count.count, history };
  }

  getRevision(userId: string, id: string): DigestV3Revision | null {
    const db = this.getDb();
    const row = queryOne<Record<string, any>>(db,
      'SELECT * FROM digest_v3_revisions WHERE user_id = ? AND id = ?', [userId, id]);
    if (!row) return null;
    const evidence = queryAll<{ evidence_id: string }>(db,
      'SELECT evidence_id FROM digest_v3_revision_evidence WHERE user_id = ? AND revision_id = ? ORDER BY evidence_id', [userId, id]);
    return { id: row.id, userId: row.user_id, eventId: row.event_id, revisionNo: row.revision_no,
      previousRevisionId: row.previous_revision_id, changeKind: row.change_kind,
      facts: JSON.parse(row.facts_json), evidenceIds: evidence.map(item => item.evidence_id),
      recordedAt: row.recorded_at, occurredAt: row.occurred_at, occurredPrecision: row.occurred_precision,
      reason: row.reason, decidedBy: row.decided_by };
  }

  addAnalysis(value: DigestV3Analysis): void {
    if (new Set(value.evidenceIds).size !== value.evidenceIds.length ||
      new Set(value.comparedRevisionIds ?? []).size !== (value.comparedRevisionIds ?? []).length) {
      throw new Error('V3 分析引用重复');
    }
    this.transaction(db => this.insertAnalysis(db, value));
  }

  private insertAnalysis(db: Database, value: DigestV3Analysis): void {
    db.run(`INSERT INTO digest_v3_analyses
      (user_id, id, event_revision_id, analysis_kind, body, author_kind, recorded_at,
       fact_key, scope, check_state, assessment, run_id, model_id, prompt_version, supersedes_analysis_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [value.userId, value.id, value.eventRevisionId, value.analysisKind, value.body,
      value.authorKind, value.recordedAt, value.factKey ?? null, value.scope ?? null,
      value.check ?? null, value.assessment ?? null, value.runId ?? null,
      value.modelId ?? null, value.promptVersion ?? null, value.supersedesAnalysisId ?? null]);
    for (const evidenceId of value.evidenceIds) db.run(
      'INSERT INTO digest_v3_analysis_evidence (user_id, analysis_id, evidence_id) VALUES (?, ?, ?)',
      [value.userId, value.id, evidenceId]);
    for (const revisionId of value.comparedRevisionIds ?? []) db.run(
      'INSERT INTO digest_v3_analysis_comparisons (user_id, analysis_id, revision_id) VALUES (?, ?, ?)',
      [value.userId, value.id, revisionId]);
  }

  /** One reviewed local submission is durable as a unit, including every exact citation. */
  saveReviewedChain(value: { evidence: DigestV3Evidence; event?: DigestV3Event; revision: DigestV3Revision; analysis: DigestV3Analysis }): void {
    const { evidence, event, revision, analysis } = value;
    if (evidence.userId !== revision.userId || analysis.userId !== revision.userId ||
      analysis.eventRevisionId !== revision.id ||
      analysis.evidenceIds.length !== 1 || analysis.evidenceIds[0] !== evidence.id ||
      revision.evidenceIds.length !== 1 || revision.evidenceIds[0] !== evidence.id ||
      (event && (event.userId !== revision.userId || event.id !== revision.eventId ||
        event.currentRevisionId !== revision.id || revision.revisionNo !== 1 ||
        revision.previousRevisionId !== null || revision.changeKind !== 'initial'))) {
      throw new Error('V3 本地链路引用不一致');
    }
    this.transaction(db => {
      this.insertEvidence(db, evidence);
      if (event) {
        this.insertEvent(db, event);
      } else {
        const current = queryOne<{ current_revision_id: string; revision_no: number }>(db,
          `SELECT e.current_revision_id, r.revision_no FROM digest_v3_events e
           JOIN digest_v3_revisions r ON r.user_id = e.user_id AND r.id = e.current_revision_id
           WHERE e.user_id = ? AND e.id = ? AND e.lifecycle = 'active'`,
          [revision.userId, revision.eventId]);
        if (!current || current.current_revision_id !== revision.previousRevisionId ||
          revision.revisionNo !== current.revision_no + 1 || revision.changeKind !== 'progress') {
          throw new DigestV3Conflict('V3 修订版本冲突');
        }
      }
      this.insertRevision(db, revision);
      if (!event) db.run('UPDATE digest_v3_events SET current_revision_id = ? WHERE user_id = ? AND id = ?',
        [revision.id, revision.userId, revision.eventId]);
      this.insertAnalysis(db, analysis);
    });
  }

  getAnalysis(userId: string, id: string): DigestV3Analysis | null {
    const db = this.getDb();
    const row = queryOne<Record<string, any>>(db,
      'SELECT * FROM digest_v3_analyses WHERE user_id = ? AND id = ?', [userId, id]);
    if (!row) return null;
    const evidence = queryAll<{ evidence_id: string }>(db,
      'SELECT evidence_id FROM digest_v3_analysis_evidence WHERE user_id = ? AND analysis_id = ? ORDER BY evidence_id', [userId, id]);
    const comparisons = queryAll<{ revision_id: string }>(db,
      'SELECT revision_id FROM digest_v3_analysis_comparisons WHERE user_id = ? AND analysis_id = ? ORDER BY revision_id', [userId, id]);
    return { id: row.id, userId: row.user_id, eventRevisionId: row.event_revision_id,
      evidenceIds: evidence.map(item => item.evidence_id),
      comparedRevisionIds: comparisons.map(item => item.revision_id),
      analysisKind: row.analysis_kind, body: row.body, authorKind: row.author_kind,
      recordedAt: row.recorded_at, factKey: row.fact_key, scope: row.scope,
      check: row.check_state, assessment: row.assessment, runId: row.run_id,
      modelId: row.model_id, promptVersion: row.prompt_version,
      supersedesAnalysisId: row.supersedes_analysis_id };
  }

  getFrozenCitation(userId: string, id: string): DigestV3FrozenCitation | null {
    const row = queryOne<Record<string, any>>(this.getDb(),
      'SELECT * FROM digest_v3_frozen_citations WHERE user_id = ? AND id = ?', [userId, id]);
    if (!row) return null;
    if (frozenCitationHash(row.snapshot_json) !== row.snapshot_sha256) throw new Error('V3 冻结引用校验失败');
    return { id: row.id, userId: row.user_id, reportDate: row.report_date,
      reportVersionKey: row.report_version_key,
      citationKey: row.citation_key, cutoff: row.cutoff, eventId: row.event_id,
      revisionId: row.revision_id, analysisId: row.analysis_id,
      previousRevisionId: row.previous_revision_id, evidenceIds: JSON.parse(row.evidence_ids_json),
      snapshot: JSON.parse(row.snapshot_json), snapshotSha256: row.snapshot_sha256,
      createdAt: row.created_at };
  }

  saveFrozenCitation(value: DigestV3FrozenCitation): void {
    const snapshotJson = JSON.stringify(value.snapshot);
    if (frozenCitationHash(snapshotJson) !== value.snapshotSha256 ||
      !frozenSnapshotValid(value.snapshot, value.evidenceIds.length)) {
      throw new Error('V3 冻结引用校验失败');
    }
    this.transaction(db => {
      const existing = queryOne<{ id: string }>(db,
        'SELECT id FROM digest_v3_frozen_citations WHERE user_id = ? AND report_version_key = ? AND citation_key = ?',
        [value.userId, value.reportVersionKey, value.citationKey]);
      if (existing) throw new DigestV3Conflict('V3 日报引用位已冻结');
      const revision = queryOne<{ event_id: string; previous_revision_id: string | null }>(db,
        'SELECT event_id, previous_revision_id FROM digest_v3_revisions WHERE user_id = ? AND id = ?',
        [value.userId, value.revisionId]);
      const analysis = queryOne<{ event_revision_id: string }>(db,
        'SELECT event_revision_id FROM digest_v3_analyses WHERE user_id = ? AND id = ?',
        [value.userId, value.analysisId]);
      const links = queryAll<{ evidence_id: string }>(db,
        `SELECT DISTINCT evidence_id FROM digest_v3_revision_evidence
         WHERE user_id = ? AND (revision_id = ? OR revision_id = ?)
         ORDER BY evidence_id`, [value.userId, value.revisionId, value.previousRevisionId]);
      if (!revision || revision.event_id !== value.eventId ||
        revision.previous_revision_id !== value.previousRevisionId ||
        !analysis || analysis.event_revision_id !== value.revisionId ||
        !sameStrings(value.evidenceIds, links.map(link => link.evidence_id))) {
        throw new Error('V3 冻结引用校验失败');
      }
      db.run(`INSERT INTO digest_v3_frozen_citations
        (user_id, id, report_date, report_version_key, citation_key, cutoff, event_id, revision_id,
         analysis_id, previous_revision_id, evidence_ids_json, snapshot_json, snapshot_sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.userId, value.id, value.reportDate, value.reportVersionKey, value.citationKey, value.cutoff,
        value.eventId, value.revisionId, value.analysisId, value.previousRevisionId,
        JSON.stringify(value.evidenceIds), snapshotJson, value.snapshotSha256, value.createdAt]);
    });
  }

  hasUserData(userId: string): boolean {
    const db = this.getDb();
    return !!queryOne(db, `SELECT id FROM digest_v3_events WHERE user_id = ? LIMIT 1`, [userId]) ||
      !!queryOne(db, `SELECT id FROM digest_v3_evidence WHERE user_id = ? LIMIT 1`, [userId]) ||
      !!queryOne(db, `SELECT id FROM digest_v3_analyses WHERE user_id = ? LIMIT 1`, [userId]) ||
      !!queryOne(db, `SELECT id FROM digest_v3_frozen_citations WHERE user_id = ? LIMIT 1`, [userId]);
  }

  exportUserData(userId: string): Record<string, unknown[]> {
    const db = this.getDb();
    return Object.fromEntries(BACKUP_TABLES.map(spec => [spec.key,
      queryAll<Record<string, unknown>>(db, `SELECT * FROM ${spec.table} WHERE user_id = ? ORDER BY rowid`, [userId]),
    ]));
  }

  validateRestore(userId: string, data: Record<string, unknown>, mode: 'merge' | 'replace'): void {
    const rows = validateDigestV3Backup(data);
    if (!rows && mode === 'replace' && this.hasUserData(userId)) {
      throw new Error('旧备份不含 V3 事件记录，不能替换已有 V3 数据');
    }
    if (rows && mode === 'replace' && !Object.hasOwn(data, FROZEN_BACKUP_TABLE.key) &&
      queryOne(this.getDb(), 'SELECT id FROM digest_v3_frozen_citations WHERE user_id = ? LIMIT 1', [userId])) {
      throw new Error('旧备份不含 V3 冻结引用，不能替换已有冻结记录');
    }
  }

  restoreUserData(userId: string, data: Record<string, unknown>, mode: 'merge' | 'replace'): void {
    const rows = validateDigestV3Backup(data);
    if (!rows) {
      this.validateRestore(userId, data, mode);
      return;
    }
    this.transaction(db => {
      db.run('PRAGMA defer_foreign_keys = ON');
      if (mode === 'replace') this.deleteRows(db, userId);
      for (const spec of BACKUP_TABLES) {
        for (const row of rows[spec.key]) {
          const values = spec.columns.map(column => column === 'user_id' ? userId : row[column]);
          db.run(`INSERT OR IGNORE INTO ${spec.table} (${spec.columns.join(', ')}) VALUES (${spec.columns.map(() => '?').join(', ')})`, values);
          const existing = queryOne<Record<string, unknown>>(db,
            `SELECT * FROM ${spec.table} WHERE user_id = ? AND ${spec.identity.map(column => `${column} = ?`).join(' AND ')}`,
            [userId, ...spec.identity.map(column => row[column])]);
          if (!existing || spec.columns.some((column, index) => existing[column] !== values[index])) {
            throw new Error('V3 事件恢复与目标记录冲突');
          }
        }
      }
    });
  }

  private deleteRows(db: Database, userId: string): void {
    for (const table of [
      'digest_v3_frozen_citations',
      'digest_v3_analysis_comparisons', 'digest_v3_analysis_evidence',
      'digest_v3_analyses', 'digest_v3_revision_evidence',
      'digest_v3_evidence', 'digest_v3_revisions', 'digest_v3_events',
    ]) db.run(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
  }

  /** Account deletion follows a full system snapshot; delete children before their parents. */
  deleteUserData(userId: string): void {
    if (!this.hasUserData(userId)) return;
    this.transaction(db => {
      this.deleteRows(db, userId);
    });
  }
}
