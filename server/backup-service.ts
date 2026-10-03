import { atomicWriteFile, withPersistenceTransaction, blockPersistenceUntilRestart } from './persistence.js';
import { SYSTEM_RESTORE_JOURNAL, type RestoreEntry } from './restore-journal.js';
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import * as db from './db.js';
import { exportOrbit, restoreOrbit } from './orbit-store.js';
import * as scheduleStore from './schedule-store.js';
import * as reminderStore from './reminder-store.js';
import * as activityStore from './activity-store.js';
import { validateDigestV3Backup } from './digest-v3-store.js';
import { validateResearchBackup } from './digest-research-store.js';
import * as attachmentService from './attachment-service.js';
import { dailyReportMediaRoot } from './daily-report-media-service.js';
import * as dailyReportCloudStore from './daily-report-cloud-store.js';
import { captureBridgeState, pauseForRestoreSync } from './caldav-control.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAGIC = Buffer.from('AICALBK1');
const FORMAT_VERSION = 1;

interface UserBackupPayload {
  missingDigestMedia?: string[];
  digestMedia?: Array<{ filename: string; sha256: string; base64: string }>;
  format: 'aicalendar-user';
  version: number;
  exportedAt: string;
  account: { email: string | null; reminder: unknown };
  schedule: ReturnType<typeof scheduleStore.exportUserScheduleData>;
  reminder: ReturnType<typeof reminderStore.exportUserReminderData>;
  orbit?: ReturnType<typeof exportOrbit>;
  noteItems?: ReturnType<typeof db.exportUserNoteItems>;
  libraryEntries?: ReturnType<typeof db.exportUserLibraryEntries>;
  dailyReportCloudContext?: ReturnType<typeof dailyReportCloudStore.getDailyReportCloudContext>;
  activity: ReturnType<typeof activityStore.exportUserActivity>;
  files: Array<{
    attachmentId?:string;
    completionId: string | null;
    importId: string | null;
    originalName: string;
    mimeType: string;
    base64: string;
  }>;
}

interface SystemBackupPayload {
  format: 'aicalendar-system';
  version: number;
  exportedAt: string;
  databases: Record<string, string>;
  files: Array<{ relativePath: string; base64: string }>;
  dailyReportMedia?: Array<{ relativePath: string; base64: string }>;
  caldavBridge?: Record<string, string>;
}

function remapForeignUserPayload(source: UserBackupPayload): UserBackupPayload {
  const payload = structuredClone(source);
  const activity = payload.activity as Record<string, any[]>;
  const createIdMap = (values: unknown[]): Map<string, string> => new Map(
    values
      .map(value => String(value || ''))
      .filter(Boolean)
      .map(value => [value, crypto.randomUUID()]),
  );
  const taskIds = createIdMap((payload.reminder.tasks || []).map(task => task.id));
  const cycleIds = createIdMap((payload.reminder.cycles || []).map(cycle => cycle.id));
  const calendarIds = createIdMap((payload.schedule.calendars || []).map(calendar => calendar.id));
  const categoryIds = createIdMap((payload.schedule.categories || []).map(category => category.id));
  const completionIds = createIdMap((activity.completions || []).map(row => row.id));
  const importIds = createIdMap((activity.aiImports || []).map(row => row.id));
  const notificationIds = createIdMap((activity.notifications || []).map(row => row.id));
  const reportIds = createIdMap((activity.dailyReports || []).map(row => row.id));
  const digestRunIds = createIdMap((activity.digestV2Runs || []).map(row => row.id));
  const research = validateResearchBackup(activity);
  const v3 = validateDigestV3Backup(activity);
  let v3RevisionIds = new Map<string, string>();
  if (v3) {
    const eventIds = createIdMap(v3.digestV3Events.map(row => row.id));
    const revisionIds = createIdMap(v3.digestV3Revisions.map(row => row.id));
    v3RevisionIds = revisionIds;
    const evidenceIds = createIdMap(v3.digestV3Evidence.map(row => row.id));
    const analysisIds = createIdMap(v3.digestV3Analyses.map(row => row.id));
    const frozenIds = createIdMap(v3.digestV3FrozenCitations.map(row => row.id));
    const frozenReportKeys = createIdMap(v3.digestV3FrozenCitations.map(row => row.report_version_key));
    const mapped = (ids: Map<string, string>, id: string | null): string | null => id == null ? null : ids.get(id)!;
    activity.digestV3Events = v3.digestV3Events.map(row => ({ ...row,
      id: mapped(eventIds, row.id), current_revision_id: mapped(revisionIds, row.current_revision_id),
      merged_into_event_id: mapped(eventIds, row.merged_into_event_id),
    }));
    activity.digestV3Revisions = v3.digestV3Revisions.map(row => ({ ...row,
      id: mapped(revisionIds, row.id), event_id: mapped(eventIds, row.event_id),
      previous_revision_id: mapped(revisionIds, row.previous_revision_id),
      facts_json: JSON.stringify(JSON.parse(row.facts_json).map((fact: any) => ({ ...fact,
        evidenceIds: fact.evidenceIds.map((id: string) => mapped(evidenceIds, id)),
      }))),
    }));
    activity.digestV3Evidence = v3.digestV3Evidence.map(row => ({ ...row,
      id: mapped(evidenceIds, row.id), related_evidence_id: mapped(evidenceIds, row.related_evidence_id),
      supersedes_evidence_id: mapped(evidenceIds, row.supersedes_evidence_id),
      linked_revision_id: mapped(revisionIds, row.linked_revision_id),
    }));
    activity.digestV3Analyses = v3.digestV3Analyses.map(row => ({ ...row,
      id: mapped(analysisIds, row.id), event_revision_id: mapped(revisionIds, row.event_revision_id),
      supersedes_analysis_id: mapped(analysisIds, row.supersedes_analysis_id),
    }));
    activity.digestV3RevisionEvidence = v3.digestV3RevisionEvidence.map(row => ({ ...row,
      revision_id: mapped(revisionIds, row.revision_id), evidence_id: mapped(evidenceIds, row.evidence_id),
    }));
    activity.digestV3AnalysisEvidence = v3.digestV3AnalysisEvidence.map(row => ({ ...row,
      analysis_id: mapped(analysisIds, row.analysis_id), evidence_id: mapped(evidenceIds, row.evidence_id),
    }));
    activity.digestV3AnalysisComparisons = v3.digestV3AnalysisComparisons.map(row => ({ ...row,
      analysis_id: mapped(analysisIds, row.analysis_id), revision_id: mapped(revisionIds, row.revision_id),
    }));
    // Keep legacy seven-table backups missing this field for replace protection.
    if (Object.hasOwn(activity, 'digestV3FrozenCitations')) {
      activity.digestV3FrozenCitations = v3.digestV3FrozenCitations.map(row => ({ ...row,
        id: mapped(frozenIds, row.id), report_version_key: `restored:${mapped(frozenReportKeys, row.report_version_key)}`,
        event_id: mapped(eventIds, row.event_id),
        revision_id: mapped(revisionIds, row.revision_id), analysis_id: mapped(analysisIds, row.analysis_id),
        previous_revision_id: mapped(revisionIds, row.previous_revision_id),
        evidence_ids_json: JSON.stringify(JSON.parse(row.evidence_ids_json).map((id: string) => mapped(evidenceIds, id)).sort()),
      }));
    }
  }
  if (research) {
    const runIds = createIdMap(research.researchRuns.map(row => row.id));
    const proposalIds = createIdMap(research.thesisProposals.map(row => row.id));
    const versionIds = createIdMap(research.thesisVersions.map(row => row.id));
    const mapped = (ids: Map<string, string>, id: string | null): string | null => id == null ? null : ids.get(id)!;
    activity.researchRuns = research.researchRuns.map(row => ({ ...row,
      id: mapped(runIds, row.id), candidate_key: `restored:${mapped(runIds, row.id)}`,
      event_revision_id: mapped(v3RevisionIds, row.event_revision_id),
      status: row.status === 'claimed' ? 'pending' : row.status,
      lease_token_hash: null, lease_until: null,
    }));
    activity.thesisProposals = research.thesisProposals.map(row => ({ ...row,
      id: mapped(proposalIds, row.id), run_id: mapped(runIds, row.run_id),
      base_version_id: mapped(versionIds, row.base_version_id),
    }));
    activity.thesisVersions = research.thesisVersions.map(row => ({ ...row,
      id: mapped(versionIds, row.id), proposal_id: mapped(proposalIds, row.proposal_id),
      previous_version_id: mapped(versionIds, row.previous_version_id),
    }));
  }
  activity.digestV2Runs = (activity.digestV2Runs || []).map(row => ({ ...row, id: digestRunIds.get(row.id), snapshot_json: null }));
  activity.digestV2Artifacts = (activity.digestV2Artifacts || []).map(row => {
    const payload = JSON.parse(row.payload_json);
    if (payload.reportId) payload.reportId = reportIds.get(payload.reportId) || null;
    return { ...row, id: crypto.randomUUID(), run_id: digestRunIds.get(row.run_id), payload_json: JSON.stringify(payload) };
  });
  const noteIds = createIdMap((payload.noteItems || []).map(row => row.id));
  const libraryIds = createIdMap((payload.libraryEntries || []).map(row => row.id));

  const scheduleIds = new Map<string, string>();
  for (const schedule of payload.schedule.schedules || []) {
    const oldId = String(schedule.id || '');
    if (!oldId) continue;
    const linkedCycle = oldId.startsWith('reminder-cycle:') ? oldId.slice('reminder-cycle:'.length) : '';
    scheduleIds.set(oldId, linkedCycle && cycleIds.has(linkedCycle)
      ? `reminder-cycle:${cycleIds.get(linkedCycle)}`
      : crypto.randomUUID());
  }

  payload.schedule.calendars = (payload.schedule.calendars || []).map(calendar => ({
    ...calendar,
    id: calendarIds.get(String(calendar.id)) || crypto.randomUUID(),
  }));
  payload.schedule.categories = (payload.schedule.categories || []).map(category => ({
    ...category,
    id: categoryIds.get(String(category.id)) || crypto.randomUUID(),
  }));
  payload.schedule.schedules = (payload.schedule.schedules || []).map(schedule => ({
    ...schedule,
    id: scheduleIds.get(String(schedule.id)) || crypto.randomUUID(),
    calendar_id: calendarIds.get(String(schedule.calendar_id)) || String(schedule.calendar_id || ''),
  }));
  payload.noteItems = (payload.noteItems || []).map(note => {
    let linkedScheduleIds: unknown = note.linked_schedule_ids;
    if (typeof linkedScheduleIds === 'string') {
      try { linkedScheduleIds = JSON.parse(linkedScheduleIds); } catch { linkedScheduleIds = []; }
    }
    return {
      ...note,
      id: noteIds.get(String(note.id)) || crypto.randomUUID(),
      linked_schedule_ids: JSON.stringify(Array.isArray(linkedScheduleIds)
        ? linkedScheduleIds.map(id => scheduleIds.get(String(id)) || String(id || '')).filter(Boolean)
        : []),
    };
  });
  payload.libraryEntries = (payload.libraryEntries || []).map(entry => ({
    ...entry,
    id: libraryIds.get(String(entry.id)) || crypto.randomUUID(),
    source_ref: entry.source_type === 'fragment' && entry.source_ref
      ? libraryIds.get(String(entry.source_ref)) || entry.source_ref
      : entry.source_ref,
  }));
  payload.reminder.tasks = (payload.reminder.tasks || []).map(task => ({
    ...task,
    id: taskIds.get(String(task.id)) || crypto.randomUUID(),
  }));
  payload.reminder.cycles = (payload.reminder.cycles || []).map(cycle => ({
    ...cycle,
    id: cycleIds.get(String(cycle.id)) || crypto.randomUUID(),
    taskId: taskIds.get(String(cycle.taskId)) || crypto.randomUUID(),
  }));

  activity.completions = (activity.completions || []).map(row => ({
    ...row,
    id: completionIds.get(String(row.id)) || crypto.randomUUID(),
    source_id: row.source_type === 'schedule'
      ? scheduleIds.get(String(row.source_id)) || String(row.source_id || '')
      : row.source_type === 'reminder'
        ? taskIds.get(String(row.source_id)) || String(row.source_id || '')
        : row.source_id,
    instance_id: row.instance_id ? cycleIds.get(String(row.instance_id)) || row.instance_id : null,
  }));
  activity.notifications = (activity.notifications || []).map(row => ({
    ...row,
    id: notificationIds.get(String(row.id)) || crypto.randomUUID(),
    source_id: row.source_type === 'schedule'
      ? scheduleIds.get(String(row.source_id)) || String(row.source_id || '')
      : row.source_type === 'reminder'
        ? taskIds.get(String(row.source_id)) || String(row.source_id || '')
        : row.source_id,
    instance_id: row.instance_id ? cycleIds.get(String(row.instance_id)) || row.instance_id : null,
    dedupe_key: `${String(row.dedupe_key || 'restored')}:restore:${crypto.randomUUID()}`,
  }));
  activity.dailyReports = (activity.dailyReports || []).map(row => ({
    ...row,
    id: reportIds.get(String(row.id)) || crypto.randomUUID(),
    email_notification_id: row.email_notification_id
      ? notificationIds.get(String(row.email_notification_id)) || null
      : null,
  }));
  activity.aiImports = (activity.aiImports || []).map(row => ({
    ...row,
    id: importIds.get(String(row.id)) || crypto.randomUUID(),
  }));
  activity.attachments = [];
  activity.emailImportSettings = (activity.emailImportSettings || []).map(row => ({
    ...row,
    import_token: crypto.randomBytes(16).toString('hex'),
  }));
  payload.files = payload.files.map(file => ({
    ...file,
    completionId: file.completionId ? completionIds.get(String(file.completionId)) || null : null,
    importId: file.importId?.startsWith('orbit:')?'orbit:'+crypto.randomUUID():file.importId ? importIds.get(String(file.importId)) || null : null,
  }));
  if (payload.account.reminder && typeof payload.account.reminder === 'object') {
    (payload.account.reminder as Record<string, unknown>).id = crypto.randomUUID();
  }
  return payload;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  if (password.length < 8) throw new Error('备份密码至少需要 8 个字符');
  return crypto.scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1 });
}

export function encryptBackup(payload: unknown, password: string): Buffer {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, salt, iv, tag, encrypted]);
}

export function decryptBackup<T>(buffer: Buffer, password: string): T {
  if (buffer.length < 52 || !buffer.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('备份文件格式不正确');
  const salt = buffer.subarray(8, 24);
  const iv = buffer.subarray(24, 36);
  const tag = buffer.subarray(36, 52);
  const encrypted = buffer.subarray(52);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(zlib.gunzipSync(compressed).toString('utf8')) as T;
  } catch {
    throw new Error('备份密码错误或文件已经损坏');
  }
}

export function createUserBackup(userId: string, password: string, allowMissingDigestMedia = false): Buffer {
  const accountData = db.exportUserAccountData(userId);
  const activity = activityStore.exportUserActivity(userId);
  const digestFilenames = new Set<string>();
  for (const row of activity.digestV2Artifacts as Array<{ payload_json: string }>) {
    for (const media of JSON.parse(row.payload_json).publication.media) digestFilenames.add(media.filename);
  }
  const digestMedia = [...digestFilenames].flatMap(filename => {
    if (!/^[a-f0-9]{64}\.(jpg|png)$/.test(filename)) throw new Error('新版媒体备份路径无效');
    if (allowMissingDigestMedia && !fs.existsSync(path.join(dailyReportMediaRoot(), filename))) return [];
    const bytes = fs.readFileSync(path.join(dailyReportMediaRoot(), filename));
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (!filename.startsWith(sha256 + '.')) throw new Error('新版媒体备份哈希不一致');
    return [{ filename, sha256, base64: bytes.toString('base64') }];
  });
  const files = activityStore.listAttachments(userId).map(record => ({
    attachmentId:record.id,
    completionId: record.completionId,
    importId: record.importId,
    originalName: record.originalName,
    mimeType: record.mimeType,
    base64: attachmentService.readAttachment(record).toString('base64'),
  }));
  const payload: UserBackupPayload = {
    format: 'aicalendar-user',
    digestMedia,
    missingDigestMedia: [...digestFilenames].filter(filename => !digestMedia.some(m => m.filename === filename)),
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    account: { email: accountData.user?.email || null, reminder: accountData.reminder },
    schedule: scheduleStore.exportUserScheduleData(userId),
    reminder: reminderStore.exportUserReminderData(userId),
    orbit: exportOrbit(userId),
    noteItems: db.exportUserNoteItems(userId),
    libraryEntries: db.exportUserLibraryEntries(userId),
    dailyReportCloudContext: dailyReportCloudStore.getDailyReportCloudContext(userId),
    activity,
    files,
  };
  return encryptBackup(payload, password);
}

function validateUserPayload(payload: UserBackupPayload): void {
  if (payload?.format !== 'aicalendar-user' || payload.version !== FORMAT_VERSION) throw new Error('不支持的用户备份版本');
  if (payload.digestMedia !== undefined) {
    if (!Array.isArray(payload.digestMedia)) throw new Error('新版媒体备份无效');
    for (const item of payload.digestMedia) {
      if (!item || !/^[a-f0-9]{64}\.(jpg|png)$/.test(item.filename) || typeof item.base64 !== 'string' || item.base64.length > 7_000_000) throw new Error('新版媒体备份无效');
      if (crypto.createHash('sha256').update(Buffer.from(item.base64, 'base64')).digest('hex') !== item.sha256 || !item.filename.startsWith(item.sha256 + '.')) throw new Error('新版媒体备份校验失败');
    }
  }
  if (!payload.schedule || !payload.reminder || !payload.activity ||
    typeof payload.activity !== 'object' || Array.isArray(payload.activity) || !Array.isArray(payload.files)) {
    throw new Error('备份内容不完整');
  }
  const v3Rows = validateDigestV3Backup(payload.activity);
  const researchRows = validateResearchBackup(payload.activity);
  const v3User = v3Rows?.digestV3Events[0]?.user_id || v3Rows?.digestV3Revisions[0]?.user_id || v3Rows?.digestV3Evidence[0]?.user_id;
  const researchUser = researchRows?.researchRuns[0]?.user_id;
  if (v3User && researchUser && v3User !== researchUser) throw new Error('研究备份与事件记录账号不一致');
  if (payload.noteItems !== undefined && !Array.isArray(payload.noteItems)) throw new Error('备份记事内容不完整');
  if (payload.libraryEntries !== undefined && !Array.isArray(payload.libraryEntries)) throw new Error('备份知识库内容不完整');
  if (payload.dailyReportCloudContext !== undefined) {
    const context = payload.dailyReportCloudContext as unknown as Record<string, unknown>;
    if (!context || typeof context !== 'object' || Array.isArray(context)
      || !Number.isInteger(context.version) || Number(context.version) < 0
      || !('context' in context)) {
      throw new Error('备份日报云端 Context 内容不完整');
    }
    dailyReportCloudStore.normalizeDailyReportCloudContext(context.context);
  }
}

export function inspectUserBackup(buffer: Buffer, password: string): Record<string, unknown> {
  const payload = decryptBackup<UserBackupPayload>(buffer, password);
  validateUserPayload(payload);
  return {
    version: payload.version,
    exportedAt: payload.exportedAt,
    sourceEmail: payload.account.email,
    counts: {
      schedules: payload.schedule.schedules?.length || 0,
      calendars: payload.schedule.calendars?.length || 0,
      reminderTasks: payload.reminder.tasks?.length || 0,
      reminderCycles: payload.reminder.cycles?.length || 0,
      completions: (payload.activity.completions || []).length,
      attachments: payload.files.length,
      notifications: (payload.activity.notifications || []).length,
      aiImports: (payload.activity.aiImports || []).length,
      dailyReports: (payload.activity.dailyReports || []).length,
      noteItems: (payload.noteItems || []).length,
      libraryEntries: (payload.libraryEntries || []).length,
      dailyReportCloudContext: payload.dailyReportCloudContext && payload.dailyReportCloudContext.version > 0 ? 1 : 0,
      digestV3Events: (payload.activity.digestV3Events || []).length,
      digestV3Revisions: (payload.activity.digestV3Revisions || []).length,
      digestV3Evidence: (payload.activity.digestV3Evidence || []).length,
      digestV3Analyses: (payload.activity.digestV3Analyses || []).length,
      digestV3FrozenCitations: (payload.activity.digestV3FrozenCitations || []).length,
      researchRuns: (payload.activity.researchRuns || []).length,
      thesisProposals: (payload.activity.thesisProposals || []).length,
      thesisVersions: (payload.activity.thesisVersions || []).length,
    },
  };
}

export function restoreUserBackup(userId: string, buffer: Buffer, password: string, mode: 'merge' | 'replace'): Record<string, unknown> {
  pauseForRestoreSync(userId);
  const decrypted = decryptBackup<UserBackupPayload>(buffer, password);
  validateUserPayload(decrypted);
  const targetAccount = db.exportUserAccountData(userId).user;
  if (!targetAccount) throw new Error('目标账号不存在');
  const isForeignAccount = String(decrypted.account.email || '').toLowerCase() !== targetAccount.email.toLowerCase();
  const payload = isForeignAccount ? remapForeignUserPayload(decrypted) : decrypted;
  activityStore.digestV3Store.validateRestore(userId, payload.activity, mode);
  activityStore.digestResearchStore.validateRestore(userId, payload.activity, mode);
  const safetyCopy = createUserBackup(userId, password, true);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  atomicWriteFile(path.join(BACKUP_DIR, 'pre-user-restore-' + userId + '-' + Date.now() + '.aicalendar-backup'), safetyCopy);
  const oldAttachments = mode === 'replace' ? activityStore.listAttachments(userId) : [];
  // Content-addressed files are additive; existing files are never removed by a user restore.
  for (const item of payload.digestMedia || []) {
    fs.mkdirSync(dailyReportMediaRoot(), { recursive: true });
    atomicWriteFile(path.join(dailyReportMediaRoot(), item.filename), Buffer.from(item.base64, 'base64'));
  }
  const attachmentFailures: Array<{ originalName: string; error: string }> = [];
  const missingMedia = [...new Set((payload.activity.dailyReports || []).flatMap((row: any) => [...String(row.markdown || '').matchAll(/\/daily-report-media\/([a-f0-9]{64}\.(?:jpg|png|webp|ico|svg))/g)].map(match => match[1])))].filter(name => !fs.existsSync(path.join(dailyReportMediaRoot(), name)));
  const result = withPersistenceTransaction(() => {
    if (mode === 'replace') db.deleteUserOperationResults(userId);
    const schedule = scheduleStore.restoreUserScheduleData(userId, payload.schedule, mode);
    const reminder = reminderStore.restoreUserReminderData(userId, payload.reminder, mode);
    const noteItems = db.restoreUserNoteItems(userId, payload.noteItems || [], mode);
    const libraryEntries = db.restoreUserLibraryEntries(userId, payload.libraryEntries || [], mode);
    const activity = activityStore.restoreUserActivity(userId, payload.activity, mode);
    if (payload.dailyReportCloudContext !== undefined) {
      dailyReportCloudStore.replaceDailyReportCloudContext(userId, payload.dailyReportCloudContext.context);
    }
    // Keep old files until structured data and attachment metadata commit together.
    const preference = payload.account.reminder as any;
    if (preference) {
      const current = db.getReminder(userId);
      const restoredPreference = mode === 'replace' || !current ? preference : current;
      db.upsertReminder({
        ...restoredPreference,
        id: current?.id || preference.id,
        user_id: userId,
        reminder_email: restoredPreference.reminder_email,
        created_at: current?.created_at || preference.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    let attachments = 0;
    const attachmentIds=new Map<string,string>();
    for (const file of payload.files) {
      try {
        const restored=withPersistenceTransaction(() => attachmentService.saveBase64Attachment({
          userId,
          completionId: file.completionId,
          importId: file.importId,
          originalName: file.originalName,
          mimeType: file.mimeType,
          base64: file.base64,
          allowDocuments:true,
        }));
        if(file.attachmentId)attachmentIds.set(file.attachmentId,restored.id);
        attachments++;
      } catch (error) {
        attachmentFailures.push({ originalName: file.originalName, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if(payload.orbit)restoreOrbit(userId,payload.orbit,mode,isForeignAccount,attachmentIds);
    return {
      schedule,
      reminder,
      noteItems,
      libraryEntries,
      activity,
      attachments,
      dailyReportCloudContext: payload.dailyReportCloudContext !== undefined,
      mode,
      idsRemapped: isForeignAccount,
      partial: attachmentFailures.length > 0 || missingMedia.length > 0,
      status: attachmentFailures.length || missingMedia.length ? 'PARTIAL' : 'COMPLETED',
      attachmentFailures,
      missingMedia,
    };
  });
  // Metadata is now durable. Reused content-addressed files must not be deleted.
  const cleanupFailures: string[] = [];
  for (const record of oldAttachments) {
    try { attachmentService.deleteAttachmentFileIfUnused(record); }
    catch { cleanupFailures.push(record.id); }
  }
  return {
    ...result, cleanupFailures, partial: result.partial || cleanupFailures.length > 0,
    status: result.partial || cleanupFailures.length ? 'PARTIAL' : 'COMPLETED'
  };
}

function collectFiles(root: string): Array<{ relativePath: string; base64: string }> {
  if (!fs.existsSync(root)) return [];
  const result: Array<{ relativePath: string; base64: string }> = [];
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else result.push({ relativePath: path.relative(root, fullPath).replace(/\\/g, '/'), base64: fs.readFileSync(fullPath).toString('base64') });
    }
  };
  walk(root);
  return result;
}

export function createSystemSnapshot(uploadToOss = true): { filename: string; path: string; size: number; ossStatus: 'disabled' | 'pending' } {
  const password = process.env.BACKUP_ENCRYPTION_KEY;
  if (!password) throw new Error('缺少 BACKUP_ENCRYPTION_KEY，无法生成系统备份');
  const payload: SystemBackupPayload = {
    format: 'aicalendar-system',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    databases: {
      'chat.db': db.exportChatDb().toString('base64'),
      'schedule.db': scheduleStore.exportScheduleDb().toString('base64'),
      'reminder.db': reminderStore.exportReminderDb().toString('base64'),
      'activity.db': activityStore.exportActivityDb().toString('base64'),
    },
    files: collectFiles(attachmentService.attachmentsRoot()),
    dailyReportMedia: collectFiles(dailyReportMediaRoot()),
    caldavBridge: captureBridgeState(),
  };
  const encrypted = encryptBackup(payload, password);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const filename = 'system-' + new Date().toISOString().replace(/[:.]/g, '-') + '.aicalendar-backup';
  const target = path.join(BACKUP_DIR, filename);
  fs.writeFileSync(target, encrypted);
  const local = fs.readdirSync(BACKUP_DIR)
    .filter(name => name.startsWith('system-'))
    .sort()
    .reverse();
  for (const name of local.slice(7)) {
    const marker = path.join(BACKUP_DIR, name + '.oss-uploaded');
    // OSS 不可用时保留尚未离机的快照，避免本地轮换造成唯一副本丢失。
    if (!hasOssConfig() || fs.existsSync(marker)) {
      fs.unlinkSync(path.join(BACKUP_DIR, name));
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
    }
  }
  return {
    filename,
    path: target,
    size: encrypted.length,
    ossStatus: uploadToOss && hasOssConfig() ? 'pending' : 'disabled',
  };
}

function hasOssConfig(): boolean {
  return !!(process.env.OSS_BUCKET && process.env.OSS_ENDPOINT && process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET);
}

let ossUploadRunning = false;

export async function uploadPendingSystemSnapshots(): Promise<{ uploaded: number; failed: number }> {
  if (!hasOssConfig() || !fs.existsSync(BACKUP_DIR) || ossUploadRunning) return { uploaded: 0, failed: 0 };
  ossUploadRunning = true;
  let uploaded = 0;
  let failed = 0;
  try {
    const pending = fs.readdirSync(BACKUP_DIR)
      .filter(name => name.startsWith('system-') && name.endsWith('.aicalendar-backup'))
      .filter(name => !fs.existsSync(path.join(BACKUP_DIR, name + '.oss-uploaded')))
      .sort();
    for (const filename of pending) {
      try {
        const target = path.join(BACKUP_DIR, filename);
        const data = fs.readFileSync(target);
        const stat = fs.statSync(target);
        const backupDate = stat.mtime.toISOString().slice(0, 10);
        await uploadOss(`daily/${backupDate}.aicalendar-backup`, data);
        const date = new Date(backupDate + 'T12:00:00Z');
        if (date.getUTCDate() === 1) {
          await uploadOss(`monthly/${backupDate.slice(0, 7)}.aicalendar-backup`, data);
          const oldMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 12, 1));
          await deleteOss(`monthly/${oldMonth.toISOString().slice(0, 7)}.aicalendar-backup`);
        }
        const oldDaily = new Date(date.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
        await deleteOss(`daily/${oldDaily}.aicalendar-backup`);
        fs.writeFileSync(path.join(BACKUP_DIR, filename + '.oss-uploaded'), new Date().toISOString(), 'utf8');
        uploaded++;
      } catch (error) {
        failed++;
        console.error('[Backup] OSS upload failed:', error);
      }
    }
  } finally {
    ossUploadRunning = false;
  }
  return { uploaded, failed };
}

export function listSystemSnapshots(): Array<{ filename: string; size: number; createdAt: string }> {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter(name => name.endsWith('.aicalendar-backup'))
    .map(filename => {
      const stat = fs.statSync(path.join(BACKUP_DIR, filename));
      return { filename, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function readSystemSnapshot(filename: string): Buffer {
  const safe = path.basename(filename);
  const target = path.join(BACKUP_DIR, safe);
  if (!target.startsWith(path.resolve(BACKUP_DIR) + path.sep) || !fs.existsSync(target)) throw new Error('系统备份不存在');
  return fs.readFileSync(target);
}

export function restoreSystemSnapshot(buffer: Buffer, confirmation: string): void {
  if (process.env.MAINTENANCE_MODE !== 'true') throw new Error('全站恢复只允许在 MAINTENANCE_MODE=true 时执行');
  if (process.env.BACKGROUND_JOBS_ENABLED === 'true') throw new Error('全站恢复前必须关闭后台任务并重启到维护模式');
  if (confirmation !== 'RESTORE AI CALENDAR') throw new Error('恢复确认文字不正确');
  pauseForRestoreSync();
  const password = process.env.BACKUP_ENCRYPTION_KEY || '';
  const payload = decryptBackup<SystemBackupPayload>(buffer, password);
  if (payload.format !== 'aicalendar-system' || payload.version !== FORMAT_VERSION) throw new Error('系统备份版本不正确');
  const databaseNames = ['chat.db', 'schedule.db', 'reminder.db', 'activity.db'] as const;
  const transactionId = crypto.randomUUID();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const databaseFiles = databaseNames.map(name => {
    const base64 = payload.databases?.[name];
    if (typeof base64 !== 'string') throw new Error(`系统备份缺少 ${name}`);
    const restored = Buffer.from(base64, 'base64');
    if (restored.length < 100 || restored.subarray(0, 16).toString('binary') !== 'SQLite format 3\u0000') {
      throw new Error(`系统备份中的 ${name} 不是有效的 SQLite 数据库`);
    }
    return {
      name,
      restored,
      target: path.join(DATA_DIR, name),
      temp: path.join(DATA_DIR, `.${name}.restore-${transactionId}`),
      previous: path.join(DATA_DIR, `.${name}.pre-restore-${transactionId}`),
      backedUp: false,
      activated: false,
    };
  });

  const attachmentRoot = path.resolve(attachmentService.attachmentsRoot());
  const resolvedDataDir = path.resolve(DATA_DIR);
  if (!attachmentRoot.startsWith(resolvedDataDir + path.sep)) throw new Error('附件目录不在数据目录内，拒绝恢复');
  const attachmentTemp = path.join(resolvedDataDir, `.attachments.restore-${transactionId}`);
  const attachmentPrevious = path.join(resolvedDataDir, `.attachments.pre-restore-${transactionId}`);
  const reportMediaRoot = path.resolve(dailyReportMediaRoot());
  if (!reportMediaRoot.startsWith(resolvedDataDir + path.sep)) throw new Error('日报图片目录不在数据目录内，拒绝恢复');
  const reportMediaTemp = path.join(resolvedDataDir, `.daily-report-media.restore-${transactionId}`);
  const reportMediaPrevious = path.join(resolvedDataDir, `.daily-report-media.pre-restore-${transactionId}`);
  const mediaFiles = payload.dailyReportMedia;
  if (mediaFiles !== undefined && !Array.isArray(mediaFiles)) throw new Error('系统备份日报图片清单不正确');
  const shouldRestoreMedia = mediaFiles !== undefined;
  const bridgeRoot = path.join(resolvedDataDir, 'caldav-bridge');
  const bridgeTemp = path.join(resolvedDataDir, `.caldav-bridge.restore-${transactionId}`);
  const bridgePrevious = path.join(resolvedDataDir, `.caldav-bridge.pre-restore-${transactionId}`);
  const shouldRestoreBridge = payload.caldavBridge !== undefined;
  let bridgeBackedUp = false;
  let bridgeActivated = false;
  let attachmentBackedUp = false;
  let attachmentActivated = false;
  let reportMediaBackedUp = false;
  let reportMediaActivated = false;
  let committed = false;

  try {
    if (shouldRestoreBridge) {
      if (!payload.caldavBridge || typeof payload.caldavBridge !== 'object' || Array.isArray(payload.caldavBridge)
        || Object.keys(payload.caldavBridge).some(name => !['state.json', 'control.json'].includes(name))) throw new Error('CalDAV 备份结构不正确');
      fs.mkdirSync(bridgeTemp);
      for (const [name, content] of Object.entries(payload.caldavBridge)) {
        if (typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024) throw new Error('CalDAV 备份大小不正确');
        JSON.parse(content);
        if (name === 'state.json') fs.writeFileSync(path.join(bridgeTemp, name), content, { mode: 0o600, flag: 'wx' });
      }
      fs.writeFileSync(path.join(bridgeTemp, 'control.json'), JSON.stringify({ version: 1, enabled: false, failures: 0, lastError: 'RESTORE_REVIEW_REQUIRED' }), { mode: 0o600, flag: 'wx' });
    }
    for (const file of databaseFiles) fs.writeFileSync(file.temp, file.restored, { flag: 'wx' });
    fs.mkdirSync(attachmentTemp, { recursive: false });
    if (!Array.isArray(payload.files)) throw new Error('系统备份附件清单不正确');
    const attachmentPaths = new Set<string>();
    for (const file of payload.files) {
      if (!file || typeof file.relativePath !== 'string' || typeof file.base64 !== 'string') {
        throw new Error('系统备份附件记录不正确');
      }
      const target = path.resolve(attachmentTemp, file.relativePath);
      if (!target.startsWith(path.resolve(attachmentTemp) + path.sep) || attachmentPaths.has(target)) {
        throw new Error('系统备份包含不安全或重复的附件路径');
      }
      attachmentPaths.add(target);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(file.base64, 'base64'), { flag: 'wx' });
    }
    if (shouldRestoreMedia) {
      fs.mkdirSync(reportMediaTemp, { recursive: false });
      const mediaPaths = new Set<string>();
      for (const file of mediaFiles || []) {
        if (!file || typeof file.relativePath !== 'string' || typeof file.base64 !== 'string') {
          throw new Error('系统备份日报图片记录不正确');
        }
        const target = path.resolve(reportMediaTemp, file.relativePath);
        if (!target.startsWith(path.resolve(reportMediaTemp) + path.sep) || mediaPaths.has(target)) {
          throw new Error('系统备份包含不安全或重复的日报图片路径');
        }
        mediaPaths.add(target);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(file.base64, 'base64'), { flag: 'wx' });
      }
    }

    // 所有输入完整暂存后，先生成当前状态的恢复点，再开始跨库切换。
    createSystemSnapshot(false);
    const restoreEntries: RestoreEntry[] = [
      ...databaseFiles.map(file => ({ target: file.name, previous: path.basename(file.previous), existed: fs.existsSync(file.target) })),
      { target: path.basename(attachmentRoot), previous: path.basename(attachmentPrevious), existed: fs.existsSync(attachmentRoot) },
      ...(shouldRestoreMedia ? [{ target: path.basename(reportMediaRoot), previous: path.basename(reportMediaPrevious), existed: fs.existsSync(reportMediaRoot) }] : []),
      ...(shouldRestoreBridge ? [{ target: 'caldav-bridge', previous: path.basename(bridgePrevious), existed: fs.existsSync(bridgeRoot) }] : []),
    ];
    atomicWriteFile(path.join(DATA_DIR, SYSTEM_RESTORE_JOURNAL), Buffer.from(JSON.stringify(restoreEntries)));
    for (const file of databaseFiles) {
      if (fs.existsSync(file.target)) {
        fs.renameSync(file.target, file.previous);
        file.backedUp = true;
      }
    }
    if (fs.existsSync(attachmentRoot)) {
      fs.renameSync(attachmentRoot, attachmentPrevious);
      attachmentBackedUp = true;
    }
    if (shouldRestoreMedia && fs.existsSync(reportMediaRoot)) {
      fs.renameSync(reportMediaRoot, reportMediaPrevious);
      reportMediaBackedUp = true;
    }
    if (shouldRestoreBridge && fs.existsSync(bridgeRoot)) { fs.renameSync(bridgeRoot, bridgePrevious); bridgeBackedUp = true; }
    for (const file of databaseFiles) {
      fs.renameSync(file.temp, file.target);
      file.activated = true;
    }
    fs.renameSync(attachmentTemp, attachmentRoot);
    attachmentActivated = true;
    if (shouldRestoreMedia) {
      fs.renameSync(reportMediaTemp, reportMediaRoot);
      reportMediaActivated = true;
    }
    if (shouldRestoreBridge) { fs.renameSync(bridgeTemp, bridgeRoot); bridgeActivated = true; }
    fs.unlinkSync(path.join(DATA_DIR, SYSTEM_RESTORE_JOURNAL));
    committed = true;
    blockPersistenceUntilRestart();
  } catch (error) {
    if (!committed) {
      const rollbackErrors: string[] = [];
      const attemptRollback = (label: string, action: () => void) => {
        try { action(); }
        catch (rollbackError) {
          rollbackErrors.push(`${label}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
        }
      };
      if (bridgeActivated && fs.existsSync(bridgeRoot)) attemptRollback('移除新 CalDAV 状态', () => fs.rmSync(bridgeRoot, { recursive: true, force: true }));
      if (bridgeBackedUp && fs.existsSync(bridgePrevious)) attemptRollback('恢复旧 CalDAV 状态', () => fs.renameSync(bridgePrevious, bridgeRoot));
      if (attachmentActivated && fs.existsSync(attachmentRoot)) {
        attemptRollback('删除新附件目录', () => fs.rmSync(attachmentRoot, { recursive: true, force: true }));
      }
      if (attachmentBackedUp && fs.existsSync(attachmentPrevious)) {
        attemptRollback('恢复旧附件目录', () => fs.renameSync(attachmentPrevious, attachmentRoot));
      }
      if (reportMediaActivated && fs.existsSync(reportMediaRoot)) {
        attemptRollback('删除新日报图片目录', () => fs.rmSync(reportMediaRoot, { recursive: true, force: true }));
      }
      if (reportMediaBackedUp && fs.existsSync(reportMediaPrevious)) {
        attemptRollback('恢复旧日报图片目录', () => fs.renameSync(reportMediaPrevious, reportMediaRoot));
      }
      for (const file of [...databaseFiles].reverse()) {
        if (file.activated && fs.existsSync(file.target)) {
          attemptRollback(`删除新数据库 ${file.name}`, () => fs.unlinkSync(file.target));
        }
        if (file.backedUp && fs.existsSync(file.previous)) {
          attemptRollback(`恢复旧数据库 ${file.name}`, () => fs.renameSync(file.previous, file.target));
        }
      }
      if (rollbackErrors.length) {
        blockPersistenceUntilRestart();
        const original = error instanceof Error ? error.message : String(error);
        throw new Error(`系统恢复失败：${original}；自动回滚未完全成功：${rollbackErrors.join('；')}`);
      }
    }
    const marker = path.join(DATA_DIR, SYSTEM_RESTORE_JOURNAL);
    if (fs.existsSync(marker)) fs.unlinkSync(marker);
    throw error;
  } finally {
    for (const file of databaseFiles) {
      if (fs.existsSync(file.temp)) {
        try { fs.unlinkSync(file.temp); }
        catch (error) { console.warn(`[Backup] 无法清理暂存数据库 ${file.name}:`, error); }
      }
    }
    if (fs.existsSync(attachmentTemp)) {
      try { fs.rmSync(attachmentTemp, { recursive: true, force: true }); }
      catch (error) { console.warn('[Backup] 无法清理暂存附件目录:', error); }
    }
    if (fs.existsSync(reportMediaTemp)) {
      try { fs.rmSync(reportMediaTemp, { recursive: true, force: true }); }
      catch (error) { console.warn('[Backup] 无法清理日报图片暂存目录:', error); }
    }
    if (fs.existsSync(bridgeTemp)) {
      try { fs.rmSync(bridgeTemp, { recursive: true, force: true }); }
      catch { console.warn('[Backup] 无法清理 CalDAV 暂存目录'); }
    }
  }

  // 切换已经完整提交；旧文件只作为清理对象，清理失败不再反向破坏新的一致状态。
  if (fs.existsSync(bridgePrevious)) {
    try { fs.rmSync(bridgePrevious, { recursive: true, force: true }); }
    catch { console.warn('[Backup] 无法清理旧 CalDAV 目录'); }
  }
  for (const file of databaseFiles) {
    if (fs.existsSync(file.previous)) {
      try { fs.unlinkSync(file.previous); }
      catch (error) { console.warn(`[Backup] 无法清理旧数据库 ${file.name}:`, error); }
    }
  }
  if (fs.existsSync(attachmentPrevious)) {
    try { fs.rmSync(attachmentPrevious, { recursive: true, force: true }); }
    catch (error) { console.warn('[Backup] 无法清理旧附件目录:', error); }
  }
  if (fs.existsSync(reportMediaPrevious)) {
    try { fs.rmSync(reportMediaPrevious, { recursive: true, force: true }); }
    catch (error) { console.warn('[Backup] 无法清理旧日报图片目录:', error); }
  }
}

function uploadOss(objectKey: string, data: Buffer): Promise<void> {
  const bucket = process.env.OSS_BUCKET!;
  const endpoint = process.env.OSS_ENDPOINT!.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID!;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET!;
  const date = new Date().toUTCString();
  const contentType = 'application/octet-stream';
  const resource = '/' + bucket + '/' + objectKey;
  const stringToSign = ['PUT', '', contentType, date, resource].join('\n');
  const signature = crypto.createHmac('sha1', accessKeySecret).update(stringToSign).digest('base64');
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: bucket + '.' + endpoint,
      path: '/' + objectKey.split('/').map(encodeURIComponent).join('/'),
      method: 'PUT',
      headers: {
        Authorization: 'OSS ' + accessKeyId + ':' + signature,
        Date: date,
        'Content-Type': contentType,
        'Content-Length': data.length,
      },
    }, response => {
      if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) resolve();
      else reject(new Error('OSS 上传失败，HTTP ' + response.statusCode));
      response.resume();
    });
    request.on('error', reject);
    request.end(data);
  });
}

function deleteOss(objectKey: string): Promise<void> {
  const bucket = process.env.OSS_BUCKET!;
  const endpoint = process.env.OSS_ENDPOINT!.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID!;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET!;
  const date = new Date().toUTCString();
  const resource = '/' + bucket + '/' + objectKey;
  const signature = crypto.createHmac('sha1', accessKeySecret).update(['DELETE', '', '', date, resource].join('\n')).digest('base64');
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: bucket + '.' + endpoint,
      path: '/' + objectKey.split('/').map(encodeURIComponent).join('/'),
      method: 'DELETE',
      headers: { Authorization: 'OSS ' + accessKeyId + ':' + signature, Date: date },
    }, response => {
      if (response.statusCode === 404 || (response.statusCode && response.statusCode >= 200 && response.statusCode < 300)) resolve();
      else reject(new Error('OSS 清理失败，HTTP ' + response.statusCode));
      response.resume();
    });
    request.on('error', reject);
    request.end();
  });
}
