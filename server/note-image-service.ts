import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { queryAll, queryOne, run } from './database/connection.js';
import * as activity from './activity-store.js';
import * as storage from './attachment-service.js';
import { withPersistenceTransaction } from './persistence.js';
import { NOTE_IMAGE_MAX_COUNT, NOTE_IMAGE_TYPES, NOTE_IMAGES_MAX_BYTES, type NoteImage } from '../src/utils/note-images.js';

export interface NoteImageLink { note_id: string; image_id: string; position: number }
function ownedImage(userId: string, id: string) {
  const row = queryOne('SELECT id FROM note_images WHERE user_id=? AND id=?', [userId, id]);
  const file = activity.getAttachment(id, userId);
  if (!row || !file) throw new Error('图片不存在、已过期或无权访问，请重新上传');
  return file;
}
export function noteImageView(userId: string, id: string): NoteImage {
  const file = ownedImage(userId, id);
  return { id, name: file.originalName, mime: file.mimeType, size: file.sizeBytes };
}
export function readNoteImage(userId: string, id: string) {
  const file = ownedImage(userId, id);
  return { mime: file.mimeType, bytes: storage.readAttachment(file) };
}
export function listNoteImages(userId: string, noteId: string): NoteImage[] {
  return queryAll<{ image_id: string }>('SELECT image_id FROM note_item_images WHERE user_id=? AND note_id=? ORDER BY position', [userId, noteId])
    .map(row => noteImageView(userId, row.image_id));
}
export function validateNoteImageIds(userId: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.length > NOTE_IMAGE_MAX_COUNT || value.some(id => typeof id !== 'string') || new Set(value).size !== value.length) throw new Error('每条记事最多 3 张不同图片');
  let bytes = 0;
  for (const id of value) bytes += ownedImage(userId, id).sizeBytes;
  if (bytes > NOTE_IMAGES_MAX_BYTES) throw new Error('记事图片合计不能超过 20MB');
  return value;
}
export function replaceNoteImages(userId: string, noteId: string, imageIds: string[]) {
  validateNoteImageIds(userId, imageIds);
  if (!queryOne('SELECT id FROM note_items WHERE user_id=? AND id=?', [userId, noteId])) throw new Error('记事不存在或无权访问');
  run('DELETE FROM note_item_images WHERE user_id=? AND note_id=?', [userId, noteId]);
  imageIds.forEach((id, position) => run('INSERT INTO note_item_images(user_id,note_id,image_id,position) VALUES (?,?,?,?)', [userId, noteId, id, position]));
}
export function deleteUnboundNoteImage(userId: string, id: string) {
  ownedImage(userId, id);
  if (queryOne('SELECT image_id FROM note_item_images WHERE user_id=? AND image_id=?', [userId, id])) throw new Error('图片仍在记事中使用，请先编辑记事移除图片');
  let file: activity.AttachmentRecord | null = null;
  withPersistenceTransaction(() => {
    run('DELETE FROM note_images WHERE user_id=? AND id=?', [userId, id]);
    file = activity.deleteAttachment(id, userId);
  });
  if (file) storage.deleteAttachmentFileIfUnused(file);
}
export function detachNoteImages(userId: string, noteId: string): string[] {
  const ids = queryAll<{ image_id: string }>('SELECT image_id FROM note_item_images WHERE user_id=? AND note_id=?', [userId, noteId]).map(row => row.image_id);
  run('DELETE FROM note_item_images WHERE user_id=? AND note_id=?', [userId, noteId]);
  return ids;
}
export function cleanupNoteImageDrafts(userId: string) {
  for (const row of queryAll<{ id: string }>('SELECT i.id FROM note_images i WHERE i.user_id=? AND i.created_at<? AND NOT EXISTS(SELECT 1 FROM note_item_images n WHERE n.user_id=i.user_id AND n.image_id=i.id)', [userId, new Date(Date.now() - 86400000).toISOString()])) deleteUnboundNoteImage(userId, row.id);
}
export async function uploadNoteImage(userId: string, input: { name: string; mime: string; base64: string }, signal?: AbortSignal) {
  if (!input || typeof input.name !== 'string' || typeof input.base64 !== 'string' || input.base64.length > 14 * 1024 * 1024 || !NOTE_IMAGE_TYPES.includes(input.mime as typeof NOTE_IMAGE_TYPES[number])) throw new Error('图片格式无效，只支持 JPEG、PNG、WebP');
  cleanupNoteImageDrafts(userId);
  const bytes = Buffer.from(input.base64, 'base64');
  storage.validateAttachmentBytes(input.mime, bytes);
  const image = sharp(bytes, { limitInputPixels: 40000000, animated: false }), meta = await image.metadata();
  if ((meta.pages || 1) > 1) throw new Error('不支持动画图片');
  const processed = await image.rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).toFormat(input.mime === 'image/jpeg' ? 'jpeg' : input.mime === 'image/png' ? 'png' : 'webp').toBuffer();
  signal?.throwIfAborted();
  return withPersistenceTransaction(() => {
    const file = storage.saveBase64Attachment({ userId, importId: 'note:' + randomUUID(), originalName: input.name, mimeType: input.mime, base64: processed.toString('base64') });
    run('INSERT INTO note_images(id,user_id,created_at) VALUES (?,?,?)', [file.id, userId, file.createdAt]);
    return noteImageView(userId, file.id);
  });
}
export function exportNoteImageLinks(userId: string): NoteImageLink[] {
  return queryAll<NoteImageLink>('SELECT note_id,image_id,position FROM note_item_images WHERE user_id=? ORDER BY note_id,position', [userId]);
}
export function clearNoteImageLinks(userId: string) {
  run('DELETE FROM note_item_images WHERE user_id=?', [userId]);
  run('DELETE FROM note_images WHERE user_id=?', [userId]);
}
export function restoreNoteImageLinks(userId: string, links: NoteImageLink[], attachmentIds: Map<string, string>): string[] {
  const missing: string[] = [];
  const grouped = new Map<string, string[]>();
  // Restore the registry for draft files too, so unbound backup assets remain eligible for cleanup.
  for (const id of new Set(attachmentIds.values())) {
    const file = activity.getAttachment(id, userId);
    if (file?.importId?.startsWith('note:') && NOTE_IMAGE_TYPES.includes(file.mimeType as typeof NOTE_IMAGE_TYPES[number])) run('INSERT OR IGNORE INTO note_images(id,user_id,created_at) VALUES (?,?,?)', [id, userId, file.createdAt]);
  }
  for (const row of links) {
    const id = attachmentIds.get(row.image_id), file = id ? activity.getAttachment(id, userId) : null;
    if (!id || !file) { missing.push(row.image_id); continue; }
    if (!queryOne('SELECT id FROM note_items WHERE user_id=? AND id=?', [userId, row.note_id])) throw new Error('图片备份关联的记事不存在');
    run('INSERT OR IGNORE INTO note_images(id,user_id,created_at) VALUES (?,?,?)', [id, userId, file.createdAt]);
    const values = grouped.get(row.note_id) || [];
    values.push(id); grouped.set(row.note_id, values);
  }
  for (const [note, ids] of grouped) {
    // A merge keeps existing note/image edits, just as the text-note restore does.
    if (!queryOne('SELECT image_id FROM note_item_images WHERE user_id=? AND note_id=?', [userId, note])) replaceNoteImages(userId, note, ids);
  }
  return missing;
}
