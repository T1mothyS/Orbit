import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, ImagePlus, X } from 'lucide-react';
import { useDialogLifecycle } from '../hooks/useDialogLifecycle';
import { fetchNoteImage, removeUnboundNoteImage, uploadNoteImage } from '../utils/note-image-client';
import { NOTE_IMAGES_MAX_BYTES, type NoteImage } from '../utils/note-images';
import { copyNoteImage } from '../utils/note-clipboard';

export function NoteImageGallery({ images, editable = false, disabled = false, onChange }: { images: NoteImage[]; editable?: boolean; disabled?: boolean; onChange?: (images: NoteImage[]) => void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [view, setView] = useState<NoteImage | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useDialogLifecycle(dialog, !!view);
  useEffect(() => {
    let active = true; const allocated: string[] = [];
    setError(''); setUrls({});
    images.forEach(image => { void fetchNoteImage(image).then(blob => { if (!active) return; const url = URL.createObjectURL(blob); allocated.push(url); setUrls(previous => ({ ...previous, [image.id]: url })); }).catch(reason => { if (active) setError(reason.message); }); });
    return () => { active = false; allocated.forEach(url => URL.revokeObjectURL(url)); };
  }, [images]);
  return <>{!!images.length && <div className="note-images" aria-label="记事图片">{images.map((image, index) => <div className="note-image" key={image.id}>
    <button type="button" className="note-image-preview" onClick={() => { setCopyStatus(''); setView(image); }} aria-label={`查看图片 ${index + 1}：${image.name}`} disabled={!urls[image.id]}>{urls[image.id] ? <img src={urls[image.id]} alt={image.name} /> : <span>读取图片…</span>}</button>
    {editable && <div className="note-image-actions"><button type="button" disabled={disabled || index === 0} aria-label={`图片 ${index + 1} 前移`} onClick={() => { const next = [...images]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange?.(next); }}><ArrowLeft size={14} /></button><button type="button" disabled={disabled || index === images.length - 1} aria-label={`图片 ${index + 1} 后移`} onClick={() => { const next = [...images]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; onChange?.(next); }}><ArrowRight size={14} /></button><button type="button" disabled={disabled} aria-label={`移除图片 ${index + 1}`} onClick={() => { onChange?.(images.filter(value => value.id !== image.id)); void removeUnboundNoteImage(image).catch(reason => setError(reason.message)); }}><X size={14} /></button></div>}
  </div>)}</div>}{error && <p className="orbit-inline-error" role="alert">{error}</p>}
  {view && createPortal(<dialog ref={dialog} className="orbit-dialog-viewport note-image-overlay" aria-label="查看记事图片" onCancel={event => { event.preventDefault(); setView(null); }} onClick={event => { if (event.target === event.currentTarget) setView(null); }}><section><button type="button" aria-label="关闭图片" onClick={() => setView(null)}><X size={20} /></button><img src={urls[view.id]} alt={view.name} /><button type="button" onClick={() => { void copyNoteImage(view).then(() => setCopyStatus('已复制图片')).catch(reason => setCopyStatus(reason.message)); }}>复制图片</button>{copyStatus && <p role="status">{copyStatus}</p>}</section></dialog>, document.body)}</>;
}

export function useNoteImageUpload(images: NoteImage[], onChange: (images: NoteImage[]) => void) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const locked = useRef(false);
  const add = async (files: File[]) => {
    if (locked.current || !files.length) return;
    locked.current = true; setBusy(true); setError('');
    const next = [...images];
    try {
      if (next.length + files.length > 3 || next.reduce((sum, image) => sum + image.size, 0) + files.reduce((sum, file) => sum + file.size, 0) > NOTE_IMAGES_MAX_BYTES) throw new Error('最多 3 张图片，合计不超过 20MB');
      for (const file of files) { next.push(await uploadNoteImage(file)); onChange([...next]); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '图片上传失败'); }
    finally { locked.current = false; setBusy(false); }
  };
  return { busy, error, add };
}
export function NoteImageInput({ inputRef, disabled, onFiles }: { inputRef: RefObject<HTMLInputElement>; disabled: boolean; onFiles: (files: File[]) => void }) {
  return <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden disabled={disabled} onChange={event => { onFiles(Array.from(event.target.files || [])); event.target.value = ''; }} />;
}
export function NoteImageEditor({ images, onChange, disabled, onBusyChange }: { images: NoteImage[]; onChange: (images: NoteImage[]) => void; disabled: boolean; onBusyChange: (busy: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null), upload = useNoteImageUpload(images, onChange);
  useEffect(() => { onBusyChange(upload.busy); }, [upload.busy, onBusyChange]);
  return <div className="note-image-editor"><NoteImageGallery images={images} editable disabled={disabled || upload.busy} onChange={onChange} /><NoteImageInput inputRef={input} disabled={disabled || upload.busy} onFiles={files => { void upload.add(files); }} /><button type="button" className="secondary-button" disabled={disabled || upload.busy || images.length >= 3} onClick={() => input.current?.click()}><ImagePlus size={16} />{upload.busy ? '上传中…' : '添加图片'}</button>{upload.error && <p role="alert" className="orbit-inline-error">{upload.error}</p>}</div>;
}
