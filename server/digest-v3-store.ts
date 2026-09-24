import type { Database } from 'sql.js';
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
      CREATE TRIGGER IF NOT EXISTS digest_v3_revision_immutable BEFORE UPDATE ON digest_v3_revisions
        BEGIN SELECT RAISE(ABORT, 'digest_v3_revision_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS digest_v3_evidence_immutable BEFORE UPDATE ON digest_v3_evidence
        BEGIN SELECT RAISE(ABORT, 'digest_v3_evidence_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS digest_v3_analysis_immutable BEFORE UPDATE ON digest_v3_analyses
        BEGIN SELECT RAISE(ABORT, 'digest_v3_analysis_immutable'); END;
      CREATE TRIGGER IF NOT EXISTS digest_v3_event_identity_immutable BEFORE UPDATE OF user_id, id ON digest_v3_events
        BEGIN SELECT RAISE(ABORT, 'digest_v3_event_identity_immutable'); END;
      INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('digest_v3', '1');
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
    this.transaction(db => db.run(`
      INSERT INTO digest_v3_evidence
        (user_id, id, url, publisher_key, document_type, language, source_fact,
         published_at, published_precision, retrieved_at, independence_key, review_state,
         source_document_key, related_evidence_id, relation, supersedes_evidence_id, linked_revision_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [value.userId, value.id, value.url, value.publisherKey, value.documentType, value.language,
      value.sourceFact, value.publishedAt, value.publishedPrecision, value.retrievedAt,
      value.independenceKey, value.reviewState, value.sourceDocumentKey ?? null,
      value.relatedEvidenceId ?? null, value.relation ?? null, value.supersedesEvidenceId ?? null,
      value.linkedRevisionId ?? null]));
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
      db.run(`INSERT INTO digest_v3_events
        (user_id, id, event_type, subject_key, occurrence_key, title, lifecycle,
         current_revision_id, merged_into_event_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.userId, event.id, event.eventType, event.subjectKey, event.occurrenceKey,
        event.title, event.lifecycle, event.currentRevisionId, event.mergedIntoEventId ?? null, event.createdAt]);
      this.insertRevision(db, first);
    });
  }

  appendRevision(value: DigestV3Revision): void {
    this.transaction(db => {
      const current = queryOne<{ current_revision_id: string; revision_no: number }>(db,
        `SELECT e.current_revision_id, r.revision_no FROM digest_v3_events e
         JOIN digest_v3_revisions r ON r.user_id = e.user_id AND r.id = e.current_revision_id
         WHERE e.user_id = ? AND e.id = ? AND e.lifecycle = 'active'`, [value.userId, value.eventId]);
      if (!current || current.current_revision_id !== value.previousRevisionId ||
        value.revisionNo !== current.revision_no + 1 || value.changeKind === 'initial') {
        throw new Error('V3 修订版本冲突');
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
    this.transaction(db => {
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

  hasUserData(userId: string): boolean {
    const db = this.getDb();
    return !!queryOne(db, `SELECT id FROM digest_v3_events WHERE user_id = ? LIMIT 1`, [userId]) ||
      !!queryOne(db, `SELECT id FROM digest_v3_evidence WHERE user_id = ? LIMIT 1`, [userId]) ||
      !!queryOne(db, `SELECT id FROM digest_v3_analyses WHERE user_id = ? LIMIT 1`, [userId]);
  }

  /** Account deletion follows a full system snapshot; delete children before their parents. */
  deleteUserData(userId: string): void {
    if (!this.hasUserData(userId)) return;
    this.transaction(db => {
      for (const table of [
        'digest_v3_analysis_comparisons', 'digest_v3_analysis_evidence',
        'digest_v3_analyses', 'digest_v3_revision_evidence',
        'digest_v3_evidence', 'digest_v3_revisions', 'digest_v3_events',
      ]) db.run(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
    });
  }
}
