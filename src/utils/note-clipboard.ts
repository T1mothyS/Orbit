import { blobDataUrl, fetchNoteImage } from './note-image-client';
import type { NoteImage } from './note-images';

export const escapeClipboardHtml = (text: string) => text.replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!);
export async function richNoteHtml(content: string, images: NoteImage[]): Promise<string> {
  const sources = await Promise.all(images.map(async image => ({ image, src: await blobDataUrl(await fetchNoteImage(image)) })));
  return `<div>${content ? `<p style="white-space:pre-wrap">${escapeClipboardHtml(content).replace(/\n/g, '<br>')}</p>` : ''}${sources.map(({ image, src }) => `<p><img src="${src}" alt="${escapeClipboardHtml(image.name)}" style="max-width:100%;height:auto" /></p>`).join('')}</div>`;
}
/** Call synchronously from the click handler; WebKit requires activation at write(). */
export function copyRichNote(content: string, images: NoteImage[]): Promise<void> {
  if (!images.length) return copyNoteText(content);
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return Promise.reject(new Error('此浏览器需要手动复制图文'));
  const html = richNoteHtml(content, images).then(value => new Blob([value], { type: 'text/html' }));
  void html.catch(() => undefined);
  try { return navigator.clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': new Blob([content || '图片记事'], { type: 'text/plain' }) })]); }
  catch (reason) { return Promise.reject(reason); }
}
export function copyNoteText(content: string): Promise<void> {
  if (!navigator.clipboard?.writeText) return Promise.reject(new Error('当前浏览器需要选择文字后使用系统复制'));
  try { return navigator.clipboard.writeText(content); } catch (reason) { return Promise.reject(reason); }
}
export function copyNoteImage(image: NoteImage, loadImage = fetchNoteImage): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return Promise.reject(new Error('当前浏览器不支持复制图片，请使用图片长按或右键菜单'));
  const png = loadImage(image).then(async blob => {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext('2d'); if (!context) { bitmap.close(); throw new Error('图片转换失败'); }
    context.drawImage(bitmap, 0, 0); bitmap.close();
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片转换失败')), 'image/png'));
  });
  void png.catch(() => undefined);
  try { return navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]); }
  catch (reason) { return Promise.reject(reason); }
}
