import crypto from 'node:crypto';
import type { Database } from 'sql.js';
import { assertPersistenceReady } from './persistence.js';

export interface ResearchRun {
  id: string;
  userId: string;
  candidateKey: string;
  subjectKey: string;
  subjectTitle: string;
  question: string;
  eventRevisionId: string | null;
  status: 'pending' | 'claimed' | 'completed' | 'failed';
  resultBody: string | null;
  createdAt: string;
  updatedAt: string;
  leaseUntil: string | null;
  attempts: number;
}

export interface ThesisProposal {
  id: string;
  userId: string;
  runId: string;
  subjectKey: string;
  body: string;
  baseVersionId: string | null;
  status: 'draft' | 'confirmed' | 'rejected';
  createdAt: string;
  decidedAt: string | null;
}

export interface ThesisVersion {
  id: string;
  userId: string;
  subjectKey: string;
  body: string;
  proposalId: string;
  previousVersionId: string | null;
  confirmedAt: string;
}

const TABLES = [
  { key: 'researchRuns', table: 'digest_research_runs', columns: ['user_id', 'id', 'candidate_key', 'subject_key', 'subject_title', 'question', 'event_revision_id', 'status', 'result_body', 'created_at', 'updated_at', 'lease_token_hash', 'lease_until', 'attempts'] },
  { key: 'thesisProposals', table: 'digest_thesis_proposals', columns: ['user_id', 'id', 'run_id', 'subject_key', 'body', 'base_version_id', 'status', 'created_at', 'decided_at'] },
  { key: 'thesisVersions', table: 'digest_thesis_versions', columns: ['user_id', 'id', 'subject_key', 'body', 'proposal_id', 'previous_version_id', 'confirmed_at'] },
] as const;

type BackupRows = Record<(typeof TABLES)[number]['key'], Array<Record<string, any>>>;

/** The three D13 arrays are optional together for backups made before D13. */
export function validateResearchBackup(data: Record<string, unknown>): BackupRows | null {
  const present = TABLES.filter(spec => Object.hasOwn(data, spec.key));
  if (!present.length) return null;
  if (present.length !== TABLES.length) throw new Error('研究备份缺少关联表');
  const rows = {} as BackupRows;
  const users = new Set<string>();
  for (const spec of TABLES) {
    const value = data[spec.key];
    if (!Array.isArray(value) || value.length > 100_000) throw new Error('研究备份数量无效');
    const seen = new Set<string>();
    rows[spec.key] = value.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item) ||
        spec.columns.some(column => !Object.hasOwn(item, column)) ||
        typeof item.user_id !== 'string' || !item.user_id ||
        typeof item.id !== 'string' || !item.id || seen.has(item.id)) {
        throw new Error('研究备份记录无效');
      }
      seen.add(item.id);
      users.add(item.user_id);
      return item;
    });
  }
  if (users.size > 1) throw new Error('研究备份混合了多个账号');
  const runs = new Map(rows.researchRuns.map(row => [row.id, row]));
  const proposals = new Map(rows.thesisProposals.map(row => [row.id, row]));
  const versions = new Map(rows.thesisVersions.map(row => [row.id, row]));
  for (const row of runs.values()) {
    if (!['pending', 'claimed', 'completed', 'failed'].includes(row.status) ||
      typeof row.question !== 'string' || typeof row.subject_key !== 'string' ||
      (row.status === 'completed' && typeof row.result_body !== 'string')) {
      throw new Error('研究备份状态无效');
    }
  }
  for (const row of proposals.values()) {
    const run = runs.get(row.run_id);
    if (!run || run.subject_key !== row.subject_key ||
      !['draft', 'confirmed', 'rejected'].includes(row.status) ||
      typeof row.body !== 'string' ||
      (row.base_version_id != null && !versions.has(row.base_version_id))) {
      throw new Error('研究备份提案引用断裂');
    }
    const linkedVersion = rows.thesisVersions.filter(version => version.proposal_id === row.id);
    if ((row.status === 'confirmed') !== (linkedVersion.length === 1)) throw new Error('研究备份提案决定断裂');
  }
  for (const row of versions.values()) {
    const proposal = proposals.get(row.proposal_id);
    if (!proposal || proposal.status !== 'confirmed' || proposal.subject_key !== row.subject_key ||
      proposal.body !== row.body || proposal.base_version_id !== row.previous_version_id ||
      (row.previous_version_id != null && versions.get(row.previous_version_id)?.subject_key !== row.subject_key)) {
      throw new Error('研究备份观点引用断裂');
    }
  }
  return rows;
}

export function migrateResearchSchema(db: Database): void {
  db.run('BEGIN TRANSACTION');
  try {
    db.run(`
      CREATE TABLE IF NOT EXISTS digest_research_runs (
        user_id TEXT NOT NULL, id TEXT NOT NULL, candidate_key TEXT NOT NULL,
        subject_key TEXT NOT NULL, subject_title TEXT NOT NULL, question TEXT NOT NULL,
        event_revision_id TEXT, status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'completed', 'failed')),
        result_body TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        lease_token_hash TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, id), UNIQUE (user_id, candidate_key),
        FOREIGN KEY (user_id, event_revision_id) REFERENCES digest_v3_revisions(user_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_digest_research_history ON digest_research_runs(user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS digest_thesis_proposals (
        user_id TEXT NOT NULL, id TEXT NOT NULL, run_id TEXT NOT NULL,
        subject_key TEXT NOT NULL, body TEXT NOT NULL, base_version_id TEXT,
        status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed', 'rejected')),
        created_at TEXT NOT NULL, decided_at TEXT,
        PRIMARY KEY (user_id, id), UNIQUE (user_id, run_id),
        FOREIGN KEY (user_id, run_id) REFERENCES digest_research_runs(user_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_digest_thesis_proposals ON digest_thesis_proposals(user_id, status, created_at DESC);
      CREATE TABLE IF NOT EXISTS digest_thesis_versions (
        user_id TEXT NOT NULL, id TEXT NOT NULL, subject_key TEXT NOT NULL,
        body TEXT NOT NULL, proposal_id TEXT NOT NULL, previous_version_id TEXT,
        confirmed_at TEXT NOT NULL,
        PRIMARY KEY (user_id, id), UNIQUE (user_id, proposal_id),
        FOREIGN KEY (user_id, proposal_id) REFERENCES digest_thesis_proposals(user_id, id),
        FOREIGN KEY (user_id, previous_version_id) REFERENCES digest_thesis_versions(user_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_digest_thesis_history ON digest_thesis_versions(user_id, subject_key, confirmed_at DESC);
      CREATE TRIGGER IF NOT EXISTS digest_thesis_version_immutable BEFORE UPDATE ON digest_thesis_versions
        BEGIN SELECT RAISE(ABORT, 'digest_thesis_version_immutable'); END;
      INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('digest_research', '1');
    `);
    db.run('COMMIT');
  } catch (error) {
    try { db.run('ROLLBACK'); } catch {}
    throw error;
  }
}

function queryAll<T>(db: Database, sql: string, params: unknown[] = []): T[] {
  assertPersistenceReady();
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    const rows: T[] = [];
    while (statement.step()) rows.push(statement.getAsObject() as T);
    return rows;
  } finally { statement.free(); }
}
function queryOne<T>(db: Database, sql: string, params: unknown[] = []): T | null {
  return queryAll<T>(db, sql, params)[0] ?? null;
}
function required(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name}无效`);
  return value.trim();
}
function rowToRun(row: Record<string, any>): ResearchRun {
  return { id: row.id, userId: row.user_id, candidateKey: row.candidate_key,
    subjectKey: row.subject_key, subjectTitle: row.subject_title, question: row.question,
    eventRevisionId: row.event_revision_id, status: row.status, resultBody: row.result_body,
    createdAt: row.created_at, updatedAt: row.updated_at, leaseUntil: row.lease_until,
    attempts: Number(row.attempts) };
}
function rowToProposal(row: Record<string, any>): ThesisProposal {
  return { id: row.id, userId: row.user_id, runId: row.run_id, subjectKey: row.subject_key,
    body: row.body, baseVersionId: row.base_version_id, status: row.status,
    createdAt: row.created_at, decidedAt: row.decided_at };
}
function rowToVersion(row: Record<string, any>): ThesisVersion {
  return { id: row.id, userId: row.user_id, subjectKey: row.subject_key,
    body: row.body, proposalId: row.proposal_id, previousVersionId: row.previous_version_id,
    confirmedAt: row.confirmed_at };
}

export class ResearchConflict extends Error {}

export class DigestResearchStore {
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

  createRun(userId: string, input: { candidateKey: string; subjectKey: string; subjectTitle: string; question: string; eventRevisionId?: string | null }, now = new Date()): ResearchRun {
    const candidateKey = required(input.candidateKey, 120, '候选键');
    const subjectKey = required(input.subjectKey, 100, '研究对象键');
    const subjectTitle = required(input.subjectTitle, 200, '研究对象');
    const question = required(input.question, 1000, '研究问题');
    const eventRevisionId = input.eventRevisionId == null ? null : required(input.eventRevisionId, 120, '事件修订');
    const createdAt = now.toISOString();
    return this.transaction(db => {
      const existing = queryOne<Record<string, any>>(db, 'SELECT * FROM digest_research_runs WHERE user_id = ? AND candidate_key = ?', [userId, candidateKey]);
      if (existing) {
        if (existing.subject_key !== subjectKey || existing.subject_title !== subjectTitle || existing.question !== question || existing.event_revision_id !== eventRevisionId) {
          throw new ResearchConflict('相同候选键的研究内容已变化');
        }
        return rowToRun(existing);
      }
      if (eventRevisionId && !queryOne(db, 'SELECT id FROM digest_v3_revisions WHERE user_id = ? AND id = ?', [userId, eventRevisionId])) {
        throw new Error('事件修订不存在或无权访问');
      }
      const id = crypto.randomUUID();
      db.run(`INSERT INTO digest_research_runs
        (user_id, id, candidate_key, subject_key, subject_title, question, event_revision_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [userId, id, candidateKey, subjectKey, subjectTitle, question, eventRevisionId, createdAt, createdAt]);
      return rowToRun(queryOne<Record<string, any>>(db, 'SELECT * FROM digest_research_runs WHERE user_id = ? AND id = ?', [userId, id])!);
    });
  }

  getRun(userId: string, id: string): ResearchRun | null {
    const row = queryOne<Record<string, any>>(this.getDb(), 'SELECT * FROM digest_research_runs WHERE user_id = ? AND id = ?', [userId, id]);
    return row ? rowToRun(row) : null;
  }

  listRuns(userId: string, limit = 50, offset = 0): ResearchRun[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new Error('分页参数无效');
    return queryAll<Record<string, any>>(this.getDb(), 'SELECT * FROM digest_research_runs WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?', [userId, limit, offset]).map(rowToRun);
  }

  claimRun(userId: string, id: string, now = new Date()): { run: ResearchRun; leaseToken: string } {
    const at = now.toISOString();
    const leaseUntil = new Date(now.getTime() + 10 * 60_000).toISOString();
    const leaseToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(leaseToken).digest('hex');
    return this.transaction(db => {
      db.run(`UPDATE digest_research_runs
        SET status = 'claimed', lease_token_hash = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
        WHERE user_id = ? AND id = ? AND (status = 'pending' OR (status = 'claimed' AND lease_until <= ?))`,
      [tokenHash, leaseUntil, at, userId, id, at]);
      if (db.getRowsModified() !== 1) throw new ResearchConflict('研究不存在、已完成或仍由其他运行领取');
      return { run: this.getRun(userId, id)!, leaseToken };
    });
  }

  completeRun(userId: string, id: string, leaseToken: string, resultBody: string, proposalBody?: string | null, now = new Date()): { run: ResearchRun; proposal: ThesisProposal | null } {
    const result = required(resultBody, 8000, '研究结果');
    const proposal = proposalBody == null ? null : required(proposalBody, 3000, '观点提案');
    const tokenHash = crypto.createHash('sha256').update(required(leaseToken, 128, '领取令牌')).digest('hex');
    const at = now.toISOString();
    return this.transaction(db => {
      const row = queryOne<Record<string, any>>(db, 'SELECT * FROM digest_research_runs WHERE user_id = ? AND id = ?', [userId, id]);
      if (!row || row.status !== 'claimed' || row.lease_token_hash !== tokenHash || row.lease_until <= at) {
        throw new ResearchConflict('研究领取已过期或不属于当前运行');
      }
      db.run(`UPDATE digest_research_runs SET status = 'completed', result_body = ?,
        lease_token_hash = NULL, lease_until = NULL, updated_at = ? WHERE user_id = ? AND id = ?`, [result, at, userId, id]);
      let draft: ThesisProposal | null = null;
      if (proposal) {
        const base = this.currentVersionRow(db, userId, row.subject_key);
        const proposalId = crypto.randomUUID();
        db.run(`INSERT INTO digest_thesis_proposals
          (user_id, id, run_id, subject_key, body, base_version_id, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
        [userId, proposalId, id, row.subject_key, proposal, base?.id ?? null, at]);
        draft = rowToProposal(queryOne<Record<string, any>>(db, 'SELECT * FROM digest_thesis_proposals WHERE user_id = ? AND id = ?', [userId, proposalId])!);
      }
      return { run: this.getRun(userId, id)!, proposal: draft };
    });
  }

  failRun(userId: string, id: string, leaseToken: string, now = new Date()): ResearchRun {
    const tokenHash = crypto.createHash('sha256').update(required(leaseToken, 128, '领取令牌')).digest('hex');
    const at = now.toISOString();
    return this.transaction(db => {
      db.run(`UPDATE digest_research_runs SET status = 'failed', lease_token_hash = NULL,
        lease_until = NULL, updated_at = ? WHERE user_id = ? AND id = ? AND status = 'claimed'
        AND lease_token_hash = ? AND lease_until > ?`, [at, userId, id, tokenHash, at]);
      if (db.getRowsModified() !== 1) throw new ResearchConflict('研究领取已过期或不属于当前运行');
      return this.getRun(userId, id)!;
    });
  }

  getProposal(userId: string, id: string): ThesisProposal | null {
    const row = queryOne<Record<string, any>>(this.getDb(), 'SELECT * FROM digest_thesis_proposals WHERE user_id = ? AND id = ?', [userId, id]);
    return row ? rowToProposal(row) : null;
  }

  listProposals(userId: string, limit = 50, offset = 0): ThesisProposal[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new Error('分页参数无效');
    return queryAll<Record<string, any>>(this.getDb(), 'SELECT * FROM digest_thesis_proposals WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?', [userId, limit, offset]).map(rowToProposal);
  }

  private currentVersionRow(db: Database, userId: string, subjectKey: string): Record<string, any> | null {
    return queryOne<Record<string, any>>(db, 'SELECT * FROM digest_thesis_versions WHERE user_id = ? AND subject_key = ? ORDER BY confirmed_at DESC, rowid DESC LIMIT 1', [userId, subjectKey]);
  }

  getCurrentVersion(userId: string, subjectKey: string): ThesisVersion | null {
    const row = this.currentVersionRow(this.getDb(), userId, subjectKey);
    return row ? rowToVersion(row) : null;
  }

  listVersions(userId: string, subjectKey: string, limit = 50): ThesisVersion[] {
    required(subjectKey, 100, '研究对象键');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('分页参数无效');
    return queryAll<Record<string, any>>(this.getDb(), 'SELECT * FROM digest_thesis_versions WHERE user_id = ? AND subject_key = ? ORDER BY confirmed_at DESC, rowid DESC LIMIT ?', [userId, subjectKey, limit]).map(rowToVersion);
  }

  decideProposal(userId: string, id: string, decision: 'confirm' | 'reject', expectedBaseVersionId: string | null, now = new Date()): { proposal: ThesisProposal; version: ThesisVersion | null } {
    if (decision !== 'confirm' && decision !== 'reject') throw new Error('提案决定无效');
    const at = now.toISOString();
    return this.transaction(db => {
      const row = queryOne<Record<string, any>>(db, 'SELECT * FROM digest_thesis_proposals WHERE user_id = ? AND id = ?', [userId, id]);
      if (!row) throw new Error('提案不存在或无权访问');
      if (row.status !== 'draft') throw new ResearchConflict('提案已处理');
      const current = this.currentVersionRow(db, userId, row.subject_key);
      if (row.base_version_id !== expectedBaseVersionId || (current?.id ?? null) !== expectedBaseVersionId) {
        throw new ResearchConflict('观点基线已变化，请重新研究');
      }
      db.run('UPDATE digest_thesis_proposals SET status = ?, decided_at = ? WHERE user_id = ? AND id = ? AND status = \'draft\'',
        [decision === 'confirm' ? 'confirmed' : 'rejected', at, userId, id]);
      let version: ThesisVersion | null = null;
      if (decision === 'confirm') {
        const versionId = crypto.randomUUID();
        db.run(`INSERT INTO digest_thesis_versions
          (user_id, id, subject_key, body, proposal_id, previous_version_id, confirmed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`, [userId, versionId, row.subject_key, row.body, id, expectedBaseVersionId, at]);
        version = rowToVersion(queryOne<Record<string, any>>(db, 'SELECT * FROM digest_thesis_versions WHERE user_id = ? AND id = ?', [userId, versionId])!);
      }
      return { proposal: this.getProposal(userId, id)!, version };
    });
  }

  hasUserData(userId: string): boolean {
    return !!queryOne(this.getDb(), 'SELECT id FROM digest_research_runs WHERE user_id = ? LIMIT 1', [userId]);
  }

  exportUserData(userId: string): Record<string, unknown[]> {
    const db = this.getDb();
    return Object.fromEntries(TABLES.map(spec => [spec.key,
      queryAll<Record<string, unknown>>(db, `SELECT * FROM ${spec.table} WHERE user_id = ? ORDER BY rowid`, [userId]),
    ]));
  }

  validateRestore(userId: string, data: Record<string, unknown>, mode: 'merge' | 'replace'): void {
    const rows = validateResearchBackup(data);
    if (!rows && mode === 'replace' && this.hasUserData(userId)) throw new Error('旧备份不含研究记录，不能替换已有研究数据');
    if (rows && mode === 'merge') {
      const incoming = new Set(rows.thesisVersions.map(row => row.id));
      for (const subjectKey of new Set(rows.thesisVersions.map(row => String(row.subject_key)))) {
        const existing = queryAll<{ id: string }>(this.getDb(),
          'SELECT id FROM digest_thesis_versions WHERE user_id = ? AND subject_key = ?', [userId, subjectKey]);
        if (existing.some(row => !incoming.has(row.id))) throw new ResearchConflict('目标账号已有独立确认的同对象观点，不能直接合并');
      }
    }
    if (rows) for (const row of rows.researchRuns) {
      const inBackup = Array.isArray(data.digestV3Revisions) && data.digestV3Revisions.some((revision: any) => revision.id === row.event_revision_id);
      const inCurrent = mode === 'merge' && queryOne(this.getDb(), 'SELECT id FROM digest_v3_revisions WHERE user_id = ? AND id = ?', [userId, row.event_revision_id]);
      if (row.event_revision_id && !inBackup && !inCurrent) {
        throw new Error('研究备份事件修订引用断裂');
      }
    }
  }

  restoreUserData(userId: string, data: Record<string, unknown>, mode: 'merge' | 'replace'): void {
    const rows = validateResearchBackup(data);
    if (!rows) return this.validateRestore(userId, data, mode);
    this.transaction(db => {
      db.run('PRAGMA defer_foreign_keys = ON');
      if (mode === 'replace') this.deleteRows(db, userId);
      for (const spec of TABLES) for (const row of rows[spec.key]) {
        const values = spec.columns.map(column => column === 'user_id' ? userId : row[column]);
        db.run(`INSERT OR IGNORE INTO ${spec.table} (${spec.columns.join(', ')}) VALUES (${spec.columns.map(() => '?').join(', ')})`, values);
        const existing = queryOne<Record<string, unknown>>(db, `SELECT * FROM ${spec.table} WHERE user_id = ? AND id = ?`, [userId, row.id]);
        if (!existing || spec.columns.some((column, index) => existing[column] !== values[index])) throw new Error('研究恢复与目标记录冲突');
      }
    });
  }

  private deleteRows(db: Database, userId: string): void {
    for (const table of ['digest_thesis_versions', 'digest_thesis_proposals', 'digest_research_runs']) {
      db.run(`DELETE FROM ${table} WHERE user_id = ?`, [userId]);
    }
  }

  deleteUserData(userId: string): void {
    if (this.hasUserData(userId)) this.transaction(db => this.deleteRows(db, userId));
  }
}
