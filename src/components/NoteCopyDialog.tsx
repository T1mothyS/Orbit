import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, IconButton } from '../ui';
import { useDialogLifecycle } from '../hooks/useDialogLifecycle';
import { copyNoteImage, copyNoteText, richNoteHtml } from '../utils/note-clipboard';
import type { NoteItem } from './NoteBoard';

export function NoteCopyDialog({ note, onClose }: { note: NoteItem; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), preview = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState(''), [message, setMessage] = useState('正在准备图文…');
  useDialogLifecycle(dialog);
  useEffect(() => { let active = true; void richNoteHtml(note.content, note.images).then(value => { if (active) { setHtml(value); setMessage('选择图文后使用系统复制；粘贴效果由目标应用决定。'); } }).catch(reason => { if (active) setMessage(reason.message); }); return () => { active = false; }; }, [note]);
  const feedback = (result: Promise<void>, success: string) => { void result.then(() => setMessage(success)).catch(reason => setMessage(reason.message || '复制失败')); };
  return createPortal(<dialog ref={dialog} className="orbit-dialog-viewport note-copy-overlay" aria-labelledby="note-copy-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><section className="oui-root note-copy-sheet"><header><h2 id="note-copy-title">复制图文记事</h2><IconButton label="关闭复制预览" variant="quiet" onClick={onClose}><X size={20} /></IconButton></header><div className="note-copy-body"><p role="status">{message}</p><div ref={preview} className="note-copy-preview" dangerouslySetInnerHTML={{ __html: html }} /><div className="note-copy-actions"><Button type="button"  disabled={!html} onClick={() => { const selection = window.getSelection(); if (preview.current && selection) { const range = document.createRange(); range.selectNodeContents(preview.current); selection.removeAllRanges(); selection.addRange(range); setMessage('图文已选中，请使用系统复制或 Ctrl+C。'); } }}>选择图文</Button><Button type="button"  onClick={() => feedback(copyNoteText(note.content), '已复制文字')}>仅复制文字</Button>{note.images.map((image, index) => <Button key={image.id} type="button"  onClick={() => feedback(copyNoteImage(image), `已复制图片 ${index + 1}`)}>复制图片 {index + 1}</Button>)}</div></div></section></dialog>, document.body);
}
