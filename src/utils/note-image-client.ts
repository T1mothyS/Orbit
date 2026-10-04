import { getStoredAuthHeaders } from '../hooks/useAuth';
import { NOTE_IMAGE_MAX_BYTES, NOTE_IMAGE_TYPES, type NoteImage } from './note-images';

export async function fetchNoteImage(image: NoteImage): Promise<Blob> {
  const response = await fetch(`/api/note-items/images/${encodeURIComponent(image.id)}`, { headers: getStoredAuthHeaders() });
  if (!response.ok) throw new Error('图片读取失败，请重新打开记事或上传图片');
  return response.blob();
}
export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(blob); });
}
export async function uploadNoteImage(file: File): Promise<NoteImage> {
  if (!NOTE_IMAGE_TYPES.includes(file.type as typeof NOTE_IMAGE_TYPES[number]) || !file.size || file.size > NOTE_IMAGE_MAX_BYTES) throw new Error('请选择 10MB 以内的 JPEG、PNG 或 WebP 图片');
  const auth = getStoredAuthHeaders();
  const accountUnchanged = () => auth.Authorization === getStoredAuthHeaders().Authorization;
  const base64 = (await blobDataUrl(file)).split(',')[1];
  if (!accountUnchanged()) throw new Error('账号已切换，请在当前账号重新上传图片');
  const response = await fetch('/api/note-items/images', { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth }, body: JSON.stringify({ name: file.name, mime: file.type, base64 }) });
  const result = await response.json();
  if (!accountUnchanged()) throw new Error('账号已切换，请在当前账号重新上传图片');
  if (!response.ok || !result.image) throw new Error(result.error || '图片上传失败');
  return result.image;
}
export async function removeUnboundNoteImage(image: NoteImage) {
  const response = await fetch(`/api/note-items/images/${encodeURIComponent(image.id)}`, { method: 'DELETE', headers: getStoredAuthHeaders() });
  // Bound files are retained by the server until their final note reference is removed.
  if (!response.ok && response.status !== 400 && response.status !== 404) throw new Error('图片移除失败');
}
