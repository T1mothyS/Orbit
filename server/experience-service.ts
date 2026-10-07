import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { queryAll, queryOne, run } from './database/connection.js';
import * as db from './db.js';
import * as library from './library-service.js';
import * as activity from './activity-store.js';
import * as storage from './attachment-service.js';
import { withPersistenceTransaction } from './persistence.js';
import {
  experienceDataSchema,
  experienceDraftSchema,
  experienceMetadataSchema,
  ExperienceError,
  revision,
  uuid,
} from './experience-contract.js';
import {
  emptyExperience,
  type ExperienceData,
  type ExperienceSession,
} from '../src/types/experience.js';
export interface ExperienceRow {
  id: string;
  user_id: string;
  entry_id: string | null;
  revision: number;
  state: ExperienceSession['state'];
  data_json: string;
  search_text: string;
  created_at: string;
  updated_at: string;
}
export interface ExperienceImageRow {
  id: string;
  user_id: string;
  session_id: string;
  upload_key: string;
  upload_hash?: string;
  created_at: string;
}
export function ownedSession(userId: string, id: string): ExperienceRow {
  const row = queryOne<ExperienceRow>(
    'SELECT * FROM library_experience_sessions WHERE user_id=? AND id=?',
    [userId, id],
  );
  if (!row) throw new ExperienceError('经历不存在或无权访问', 404);
  return row;
}
export function sessionForEntry(userId: string, id: string) {
  return queryOne<ExperienceRow>(
    'SELECT * FROM library_experience_sessions WHERE user_id=? AND entry_id=?',
    [userId, id],
  );
}
export const dataOf = (row: ExperienceRow): ExperienceData =>
  JSON.parse(row.data_json);
export function assertEditable(row: ExperienceRow) {
  if (
    row.entry_id &&
    db.getLibraryEntry(row.entry_id, row.user_id)?.status !== 'active'
  )
    throw new ExperienceError('请先恢复已归档的经历', 409);
}
export function checkRevision(row: ExperienceRow, expected: unknown) {
  if (row.revision !== revision(expected))
    throw new ExperienceError(
      '内容已在另一处更新，请重新读取；当前输入仍可保留',
      409,
    );
}
function serializeData(data: ExperienceData) {
  if (!experienceDataSchema.safeParse(data).success)
    throw new ExperienceError(
      '复盘内容格式不完整或过长，请整理保存后开始新经历',
    );
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > 1000000)
    throw new ExperienceError('这次复盘内容过长，请先整理保存');
  return json;
}
export function writeSession(
  row: ExperienceRow,
  data: ExperienceData,
  state = row.state,
  entryId = row.entry_id,
) {
  const serialized = serializeData(data);
  const search =
    state === 'saved' && data.draft
      ? [
          data.draft.experience.time.description,
          ...data.draft.experience.places,
          data.draft.experience.impression,
          data.draft.experience.repeatIntent,
          ...data.draft.experience.audienceNotes,
          ...data.draft.experience.lessons,
        ].join(' ')
      : row.search_text;
  const result = run(
    'UPDATE library_experience_sessions SET data_json=?,state=?,entry_id=?,search_text=?,revision=revision+1,updated_at=? WHERE user_id=? AND id=? AND revision=?',
    [
      serialized,
      state,
      entryId,
      search,
      new Date().toISOString(),
      row.user_id,
      row.id,
      row.revision,
    ],
  );
  if (!result.changes) throw new ExperienceError('内容已更新，请重新读取', 409);
}
export function imageView(userId: string, id: string, sessionId?: string) {
  const row = queryOne<ExperienceImageRow>(
    'SELECT * FROM library_experience_images WHERE user_id=? AND id=?',
    [userId, id],
  );
  const file = activity.getAttachment(id, userId);
  if (!row || !file || (sessionId && row.session_id !== sessionId))
    throw new ExperienceError('图片不存在或无权访问', 404);
  ownedSession(userId, row.session_id);
  return {
    id,
    name: file.originalName,
    mime: file.mimeType,
    size: file.sizeBytes,
  };
}
export function readImage(userId: string, id: string) {
  imageView(userId, id);
  const file = activity.getAttachment(id, userId)!;
  return { mime: file.mimeType, bytes: storage.readAttachment(file) };
}
export function sessionView(userId: string, id: string): ExperienceSession {
  const row = ownedSession(userId, id),
    data = dataOf(row);
  // Missing restore assets remain visible as placeholders rather than hiding the record.
  const images = data.imageIds.map((image) => {
    try {
      return imageView(userId, image, id);
    } catch {
      return {
        id: image,
        name: '图片缺失，请重新添加',
        mime: 'image/jpeg',
        size: 0,
      };
    }
  });
  return {
    id: row.id,
    entryId: row.entry_id,
    revision: row.revision,
    state: row.state,
    data,
    images,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export function createSession(userId: string, requestId: unknown) {
  const id = uuid(requestId),
    existing = queryOne<ExperienceRow>(
      'SELECT * FROM library_experience_sessions WHERE id=?',
      [id],
    );
  if (existing) {
    if (existing.user_id !== userId)
      throw new ExperienceError('请求编号已使用', 409);
    return sessionView(userId, id);
  }
  const now = new Date().toISOString(),
    data: ExperienceData = {
      messages: [],
      draft: null,
      imageIds: [],
      followUps: 0,
      lookups: [],
      steps: [],
      requests: [],
      error: null,
    };
  run(
    'INSERT INTO library_experience_sessions(id,user_id,state,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    [id, userId, 'collecting', JSON.stringify(data), now, now],
  );
  return sessionView(userId, id);
}
export function listSessions(userId: string) {
  return queryAll<ExperienceRow>(
    "SELECT * FROM library_experience_sessions WHERE user_id=? AND (entry_id IS NULL OR (state<>'saved' AND EXISTS (SELECT 1 FROM library_entries e WHERE e.id=entry_id AND e.user_id=library_experience_sessions.user_id AND e.status='active'))) ORDER BY updated_at DESC",
    [userId],
  ).map((row) => {
    const data = dataOf(row);
    return {
      id: row.id,
      revision: row.revision,
      state: row.state,
      title:
        data.draft?.title ||
        data.messages.find((m) => m.role === 'user')?.text.slice(0, 50) ||
        '未完成经历',
      updatedAt: row.updated_at,
    };
  });
}
export function validateImages(
  userId: string,
  sid: string,
  ids: unknown,
): string[] {
  if (
    !Array.isArray(ids) ||
    ids.length > 3 ||
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids).size !== ids.length
  )
    throw new ExperienceError('最多三张不同照片');
  if (
    ids.reduce((total, id) => total + imageView(userId, id, sid).size, 0) >
    20 * 1024 * 1024
  )
    throw new ExperienceError('照片合计不能超过20MB');
  return ids;
}
export function saveDraft(
  userId: string,
  sid: string,
  body: {
    expectedRevision: unknown;
    draft?: unknown;
    imageIds?: unknown;
  },
) {
  const row = ownedSession(userId, sid);
  checkRevision(row, body.expectedRevision);
  if (row.state === 'generating')
    throw new ExperienceError('正在整理，请先停止或等整理完成', 409);
  if (
    row.entry_id &&
    db.getLibraryEntry(row.entry_id, userId)?.status !== 'active'
  )
    throw new ExperienceError('请先恢复已归档的经历', 409);
  const data = dataOf(row);
  if (body.imageIds !== undefined)
    data.imageIds = validateImages(userId, sid, body.imageIds);
  if (body.draft !== undefined) {
    const result = experienceDraftSchema.safeParse(body.draft);
    if (!result.success)
      throw new ExperienceError(
        '草稿信息无效，请检查标题、正文、日期和内容长度',
      );
    data.draft = result.data;
  }
  if (data.draft) data.draft.experience.imageIds = [...data.imageIds];
  data.error = null;
  writeSession(row, data, data.draft ? 'ready' : 'collecting');
  return sessionView(userId, sid);
}
export function confirmSession(
  userId: string,
  sid: string,
  expectedRevision: unknown,
) {
  return withPersistenceTransaction(() => {
    const row = ownedSession(userId, sid),
      data = dataOf(row);
    if (row.state === 'saved' && row.entry_id) return sessionView(userId, sid);
    checkRevision(row, expectedRevision);
    if (row.state === 'generating' || !data.draft)
      throw new ExperienceError('请先整理并预览经历');
    const draft = experienceDraftSchema.parse(data.draft);
    validateImages(userId, sid, data.imageIds);
    const input = {
      ...draft,
      kind: 'article',
      type: 'experience',
      status: 'active',
      sourceType: 'orbit_experience',
      sourceId: 'orbit-experience:' + sid,
      metadata: {
        experience: { ...draft.experience, imageIds: data.imageIds },
      },
    };
    let entry: library.LibraryEntry;
    if (row.entry_id) {
      const old = db.getLibraryEntry(row.entry_id, userId);
      if (
        !old ||
        old.source_type !== 'orbit_experience' ||
        old.status !== 'active'
      )
        throw new ExperienceError('经历已归档或不存在', 409);
      entry = library.updateLibraryEntry(userId, row.entry_id, input)!.entry;
    } else entry = library.createLibraryEntry(userId, input).entry;
    writeSession(row, data, 'saved', entry.id);
    return sessionView(userId, sid);
  });
}
export function organizeOriginal(
  userId: string,
  sid: string,
  expected: unknown,
  text: unknown,
) {
  const row = ownedSession(userId, sid);
  checkRevision(row, expected);
  assertEditable(row);
  if (row.state === 'generating')
    throw new ExperienceError('请先停止整理', 409);
  if (typeof text !== 'string' || text.length > 20000)
    throw new ExperienceError('原话太长或格式无效');
  const data = dataOf(row);
  if (text.trim())
    data.messages.push({
      role: 'user',
      text: text.trim(),
      at: new Date().toISOString(),
    });
  const content = data.messages
    .filter((m) => m.role === 'user')
    .map((m) => m.text)
    .join('\n\n');
  if (!content) throw new ExperienceError('请先说说这段经历');
  data.draft = experienceDraftSchema.parse({
    title: content.slice(0, 50),
    summary: content.slice(0, 200),
    content,
    tags: [],
    experience: { ...emptyExperience(), imageIds: data.imageIds },
  });
  data.error = null;
  writeSession(row, data, 'ready');
  return sessionView(userId, sid);
}
export function experienceLifecycle(
  userId: string,
  sid: string,
  expected: unknown,
  action: 'archive' | 'restore' | 'purge',
) {
  const row = ownedSession(userId, sid);
  checkRevision(row, expected);
  if (row.state === 'generating')
    throw new ExperienceError('请先停止整理', 409);
  const files = queryAll<ExperienceImageRow>(
    'SELECT * FROM library_experience_images WHERE user_id=? AND session_id=?',
    [userId, sid],
  ).flatMap((i) => {
    const f = activity.getAttachment(i.id, userId);
    return f ? [f] : [];
  });
  withPersistenceTransaction(() => {
    if (action === 'purge') {
      if (
        row.entry_id &&
        db.getLibraryEntry(row.entry_id, userId)?.status !== 'archived'
      )
        throw new ExperienceError('请先移入已归档，再永久删除');
      if (row.entry_id)
        library.applyLibraryLifecycle(
          userId,
          ['orbit-experience:' + sid],
          'purge',
        );
      for (const file of files) activity.deleteAttachment(file.id, userId);
      run(
        'DELETE FROM library_experience_images WHERE user_id=? AND session_id=?',
        [userId, sid],
      );
      run('DELETE FROM library_experience_sessions WHERE user_id=? AND id=?', [
        userId,
        sid,
      ]);
    } else {
      if (!row.entry_id) throw new ExperienceError('尚未保存的复盘可直接删除');
      library.applyLibraryLifecycle(
        userId,
        ['orbit-experience:' + sid],
        action === 'archive' ? 'retire' : 'restore',
      );
      writeSession(row, dataOf(row), row.state);
    }
  });
  if (action === 'purge')
    for (const file of files) storage.deleteAttachmentFileIfUnused(file);
}
export async function uploadImage(
  userId: string,
  sid: string,
  input: {
    requestId: unknown;
    expectedRevision: unknown;
    name: string;
    mime: string;
    base64: string;
  },
  signal?: AbortSignal,
) {
  const row = ownedSession(userId, sid),
    key = uuid(input.requestId);
  if (
    typeof input.base64 !== 'string' ||
    input.base64.length > 14 * 1024 * 1024 ||
    typeof input.name !== 'string' ||
    input.name.length > 240
  )
    throw new ExperienceError('图片信息无效或超过大小限制');
  const hash = createHash('sha256')
    .update(JSON.stringify([input.name, input.mime, input.base64]))
    .digest('hex');
  const old = queryOne<ExperienceImageRow>(
    'SELECT * FROM library_experience_images WHERE user_id=? AND session_id=? AND upload_key=?',
    [userId, sid, key],
  );
  if (old) {
    if (old.upload_hash !== hash)
      throw new ExperienceError('上传编号对应另一张照片', 409);
    return {
      image: imageView(userId, old.id, sid),
      session: sessionView(userId, sid),
    };
  }
  checkRevision(row, input.expectedRevision);
  assertEditable(row);
  if (row.state === 'generating')
    throw new ExperienceError('请等整理完成后添加照片', 409);
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(input.mime) ||
    typeof input.base64 !== 'string' ||
    input.base64.length > 14 * 1024 * 1024 ||
    typeof input.name !== 'string'
  )
    throw new ExperienceError('只支持JPEG、PNG、WebP图片');
  const bytes = Buffer.from(input.base64, 'base64');
  storage.validateAttachmentBytes(input.mime, bytes);
  const image = sharp(bytes, { limitInputPixels: 40000000, animated: false }),
    meta = await image.metadata();
  if ((meta.pages || 1) > 1) throw new ExperienceError('不支持动画图片');
  const processed = await image
    .rotate()
    .resize({
      width: 2048,
      height: 2048,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toFormat(
      input.mime === 'image/jpeg'
        ? 'jpeg'
        : input.mime === 'image/png'
          ? 'png'
          : 'webp',
    )
    .toBuffer();
  signal?.throwIfAborted();
  return withPersistenceTransaction(() => {
    const current = ownedSession(userId, sid);
    checkRevision(current, input.expectedRevision);
    assertEditable(current);
    const data = dataOf(current);
    if (data.imageIds.length >= 3) throw new ExperienceError('最多三张照片');
    if (
      data.imageIds.reduce(
        (total, id) => total + imageView(userId, id, sid).size,
        0,
      ) +
        processed.length >
      20 * 1024 * 1024
    )
      throw new ExperienceError('照片合计不能超过20MB');
    const nextIds = [...data.imageIds, randomUUID()];
    serializeData({
      ...data,
      imageIds: nextIds,
      draft: data.draft
        ? {
            ...data.draft,
            experience: { ...data.draft.experience, imageIds: nextIds },
          }
        : null,
    });
    const file = storage.saveBase64Attachment({
      userId,
      importId: 'experience:' + sid + ':' + key,
      originalName: input.name,
      mimeType: input.mime,
      base64: processed.toString('base64'),
    });
    run(
      'INSERT INTO library_experience_images(id,user_id,session_id,upload_key,created_at,upload_hash) VALUES (?,?,?,?,?,?)',
      [file.id, userId, sid, key, file.createdAt, hash],
    );
    data.imageIds = validateImages(userId, sid, [...data.imageIds, file.id]);
    if (data.draft) data.draft.experience.imageIds = data.imageIds;
    writeSession(current, data, data.draft ? 'ready' : current.state);
    return {
      image: imageView(userId, file.id, sid),
      session: sessionView(userId, sid),
    };
  });
}
export function exportExperience(
  userId: string,
  sid?: string,
  includeFiles = false,
) {
  const sessions = sid
    ? [ownedSession(userId, sid)]
    : queryAll<ExperienceRow>(
        'SELECT * FROM library_experience_sessions WHERE user_id=?',
        [userId],
      );
  const ids = new Set(sessions.map((s) => s.id));
  const images = queryAll<ExperienceImageRow>(
    'SELECT * FROM library_experience_images WHERE user_id=?',
    [userId],
  ).filter((i) => ids.has(i.session_id));
  const versions = sessions.flatMap((s) =>
    s.entry_id ? db.listLibraryEntryVersions(s.entry_id, userId) : [],
  );
  const files: Array<{
      id: string;
      name: string;
      mime: string;
      base64: string;
    }> = [],
    missingImages: string[] = [];
  if (includeFiles)
    for (const image of images) {
      try {
        const file = activity.getAttachment(image.id, userId)!;
        files.push({
          id: image.id,
          name: file.originalName,
          mime: file.mimeType,
          base64: storage.readAttachment(file).toString('base64'),
        });
      } catch {
        missingImages.push(image.id);
      }
    }
  const entries = sessions.flatMap((s) =>
    s.entry_id ? [db.getLibraryEntry(s.entry_id, userId)!].filter(Boolean) : [],
  );
  return {
    schemaVersion: 1 as const,
    sessions,
    images,
    versions,
    entries,
    ...(includeFiles ? { files, missingImages } : {}),
  };
}
export type ExperienceBackup = ReturnType<typeof exportExperience>;
export function validateExperienceBackup(
  value: unknown,
  entries: Array<Partial<db.DbLibraryEntry>> = [],
): asserts value is ExperienceBackup {
  if (!value || typeof value !== 'object')
    throw new ExperienceError('经历备份无效');
  const data = value as ExperienceBackup;
  if (
    data.schemaVersion !== 1 ||
    !Array.isArray(data.sessions) ||
    !Array.isArray(data.images) ||
    !Array.isArray(data.versions) ||
    data.sessions.length > 10000 ||
    data.images.length > 50000 ||
    data.versions.length > 50000
  )
    throw new ExperienceError('经历备份不完整或过大');
  const ids = new Set<string>();
  for (const row of data.sessions) {
    uuid(row.id);
    revision(row.revision);
    if (
      ids.has(row.id) ||
      typeof row.data_json !== 'string' ||
      row.data_json.length > 1000000 ||
      !['collecting', 'generating', 'ready', 'saved'].includes(row.state)
    )
      throw new ExperienceError('经历会话备份无效');
    ids.add(row.id);
    const parsed = experienceDataSchema.parse(dataOf(row));
    if (
      new Set(parsed.requests.map((r) => r.id)).size !==
        parsed.requests.length ||
      typeof row.search_text !== 'string' ||
      row.search_text.length > 25000 ||
      [row.created_at, row.updated_at].some(
        (v) => typeof v !== 'string' || Number.isNaN(Date.parse(v)),
      )
    )
      throw new ExperienceError('经历问答备份无效');
    if (
      row.entry_id &&
      !entries.some(
        (e) =>
          e.id === row.entry_id &&
          e.type === 'experience' &&
          e.source_type === 'orbit_experience' &&
          e.source_id === 'orbit-experience:' + row.id,
      )
    )
      throw new ExperienceError('经历备份缺少对应知识条目');
  }
  const imageIds = new Set<string>();
  for (const row of data.images) {
    uuid(row.id);
    uuid(row.upload_key);
    if (imageIds.has(row.id) || !ids.has(row.session_id))
      throw new ExperienceError('经历图片备份无效');
    imageIds.add(row.id);
  }
  const validateImageRefs = (sessionId: string, refs: string[]) => {
    for (const id of refs)
      if (
        !data.images.some(
          (image) => image.id === id && image.session_id === sessionId,
        )
      )
        throw new ExperienceError('经历图片关联到错误会话');
  };
  for (const row of data.sessions) {
    const parsed = dataOf(row);
    validateImageRefs(row.id, parsed.imageIds);
    if (parsed.draft)
      validateImageRefs(row.id, parsed.draft.experience.imageIds);
  }
  for (const entry of entries.filter(
    (e) => e.source_type === 'orbit_experience',
  )) {
    const session = data.sessions.find((s) => s.entry_id === entry.id);
    if (!session) throw new ExperienceError('经历备份缺少原始复盘');
    if (!data.versions.some((v) => v.entry_id === entry.id))
      throw new ExperienceError('经历备份缺少历史版本');
    const meta = experienceMetadataSchema.parse(
      JSON.parse(entry.metadata_json || '{}').experience,
    );
    validateImageRefs(session.id, meta.imageIds);
  }
  const entryIds = new Set(data.sessions.map((s) => s.entry_id));
  const versionIds = new Set<string>();
  for (const row of data.versions) {
    uuid(row.id);
    if (
      versionIds.has(row.id) ||
      !entryIds.has(row.entry_id) ||
      typeof row.content !== 'string' ||
      row.content.length > 800000 ||
      typeof row.metadata_json !== 'string'
    )
      throw new ExperienceError('经历版本备份无效');
    versionIds.add(row.id);
    const meta = experienceMetadataSchema.parse(
      JSON.parse(row.metadata_json).experience,
    );
    const session = data.sessions.find((s) => s.entry_id === row.entry_id)!;
    validateImageRefs(session.id, meta.imageIds);
  }
}
export function restoreExperience(
  userId: string,
  data: ExperienceBackup | undefined,
  mode: 'merge' | 'replace',
  attachmentIds: Map<string, string>,
  foreign = false,
  libraryIds?: Map<string, string>,
) {
  if (!data) return [] as string[];
  const missing: string[] = [],
    sessionIds = new Map(
      data.sessions.map((row) => [row.id, foreign ? randomUUID() : row.id]),
    );
  const skipped = new Set<string>();
  if (mode === 'replace') {
    run('DELETE FROM library_experience_images WHERE user_id=?', [userId]);
    run('DELETE FROM library_experience_sessions WHERE user_id=?', [userId]);
  }
  // Missing files still get isolated ownership placeholders, including historical versions.
  for (const image of data.images)
    if (!attachmentIds.has(image.id)) attachmentIds.set(image.id, randomUUID());
  const mapMetadata = (json: string) => {
    const meta = JSON.parse(json || '{}');
    if (meta.experience)
      meta.experience.imageIds = (meta.experience.imageIds || []).map(
        (id: string) => attachmentIds.get(id) || id,
      );
    return JSON.stringify(meta);
  };
  for (const old of data.sessions) {
    const id = sessionIds.get(old.id)!;
    const collision = queryOne<ExperienceRow>(
      'SELECT * FROM library_experience_sessions WHERE id=?',
      [id],
    );
    if (collision) {
      if (collision.user_id !== userId)
        throw new ExperienceError('经历编号属于其他账号');
      skipped.add(old.id);
      continue;
    }
    const entryId = old.entry_id
      ? libraryIds?.get(old.entry_id) || old.entry_id
      : null;
    const parsed = dataOf(old);
    parsed.imageIds = parsed.imageIds.map(
      (image) => attachmentIds.get(image) || image,
    );
    if (parsed.draft) parsed.draft.experience.imageIds = [...parsed.imageIds];
    parsed.requests = parsed.requests.map((request) => ({
      ...request,
      status: request.status === 'running' ? 'interrupted' : request.status,
    }));
    parsed.error =
      old.state === 'generating'
        ? '恢复的整理任务已中断，请手动重试'
        : parsed.error;
    run(
      'INSERT INTO library_experience_sessions(id,user_id,entry_id,revision,state,data_json,search_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [
        id,
        userId,
        entryId,
        old.revision,
        old.state === 'generating' ? 'collecting' : old.state,
        JSON.stringify(parsed),
        old.search_text,
        old.created_at,
        old.updated_at,
      ],
    );
    if (entryId) {
      const entry = db.getLibraryEntry(entryId, userId);
      if (!entry || entry.source_type !== 'orbit_experience')
        throw new ExperienceError('经历恢复条目不匹配');
      db.updateLibraryEntry(entryId, userId, {
        source_id: 'orbit-experience:' + id,
        metadata_json: mapMetadata(entry.metadata_json),
      });
    }
  }
  for (const old of data.images) {
    if (skipped.has(old.session_id)) continue;
    const id = attachmentIds.get(old.id);
    if (!activity.getAttachment(id!, userId)) missing.push(old.id);
    run(
      'INSERT INTO library_experience_images(id,user_id,session_id,upload_key,created_at,upload_hash) VALUES (?,?,?,?,?,?)',
      [
        id,
        userId,
        sessionIds.get(old.session_id),
        old.upload_key,
        old.created_at,
        old.upload_hash || '',
      ],
    );
  }
  for (const old of data.sessions)
    if (old.entry_id && !skipped.has(old.id)) {
      const entryId = libraryIds?.get(old.entry_id) || old.entry_id;
      run('DELETE FROM library_entry_versions WHERE user_id=? AND entry_id=?', [
        userId,
        entryId,
      ]);
      for (const v of data.versions.filter((v) => v.entry_id === old.entry_id))
        db.createLibraryEntryVersion({
          ...v,
          id: foreign ? randomUUID() : v.id,
          user_id: userId,
          entry_id: entryId,
          metadata_json: mapMetadata(v.metadata_json || '{}'),
        });
    }
  return missing;
}
