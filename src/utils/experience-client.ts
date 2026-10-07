import { getStoredAuthHeaders } from '../hooks/useAuth';
import type { NoteImage } from './note-images';
export const experienceBase = '/api/library/experience-sessions';
export async function experienceApi(path = '', method = 'GET', body?: unknown) {
  const headers = getStoredAuthHeaders();
  const response = await fetch(experienceBase + path, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (headers.Authorization !== getStoredAuthHeaders().Authorization)
    throw new Error('账号已切换，请重新打开经历');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || '操作失败，请重试');
  return data;
}
export async function fetchExperienceImage(image: NoteImage) {
  const headers = getStoredAuthHeaders(),
    res = await fetch(
      experienceBase + '/images/' + encodeURIComponent(image.id),
      { headers },
    );
  if (headers.Authorization !== getStoredAuthHeaders().Authorization || !res.ok)
    throw new Error('照片读取失败，原记录仍保留，可重新添加照片');
  return res.blob();
}
// Removed images stay owned by the session for saved version snapshots.
export async function retainExperienceImage(_image: NoteImage) {}
export async function downloadExperience(id: string) {
  const bundle = await experienceApi('/' + id + '/export'),
    url = URL.createObjectURL(
      new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
    );
  const link = document.createElement('a');
  link.href = url;
  link.download = `experience-${id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
