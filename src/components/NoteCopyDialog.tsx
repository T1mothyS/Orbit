import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogLifecycle } from '../hooks/useDialogLifecycle';
import { copyNoteImage, copyNoteText, richNoteHtml } from '../utils/note-clipboard';
import type { NoteItem } from './NoteBoard';

export function NoteCopyDialog({ note, onClose }: { note: NoteItem; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), preview = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState(''), [message, setMessage] = useState('正在准备图文…');
  useDialogLifecycle(dialog);
  useEffect(() => { let active = true; void richNoteHtml(note.content, note.images).then(value => { if (active) { setHtml(value); setMessage('选择图文后使用系统复制；粘贴效果由目标应用决定。'); } }).catch(reason => { if (active) setMessage(reason.message); }); return () => { active = false; }; }, [note]);
  const feedback = (result: Promise<void>, success: string) => { void result.then(() => setMessage(success)).catch(reason => setMessage(reason.message || '复制失败')); };
  return createPortal(<dialog ref={dialog} className="orbit-dialog-viewport compact-sheet-overlay" aria-labelledby="note-copy-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><section className="compact-sheet note-copy-sheet"><header><h2 id="note-copy-title">复制图文记事</h2><button type="button" aria-label="关闭复制预览" onClick={onClose}><X size={20} /></button></header><div className="compact-sheet-body"><p role="status">{message}</p><div ref={preview} className="note-copy-preview" dangerouslySetInnerHTML={{ __html: html }} /><div className="note-copy-actions"><button type="button" className="secondary-button" disabled={!html} onClick={() => { const selection = window.getSelection(); if (preview.current && selection) { const range = document.createRange(); range.selectNodeContents(preview.current); selection.removeAllRanges(); selection.addRange(range); setMessage('图文已选中，请使用系统复制或 Ctrl+C。'); } }}>选择图文</button><button type="button" className="secondary-button" onClick={() => feedback(copyNoteText(note.content), '已复制文字')}>仅复制文字</button>{note.images.map((image, index) => <button key={image.id} type="button" className="secondary-button" onClick={() => feedback(copyNoteImage(image), `已复制图片 ${index + 1}`)}>复制图片 {index + 1}</button>)}</div></div></section></dialog>, document.body);
}
