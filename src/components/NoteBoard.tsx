import { IconButton, useActionConfirmation } from '../ui';
import { NoteLinks } from './NoteLinks';
import { NoteImageGallery } from './NoteImages';
import { NoteEditor } from './NoteEditor';
import { NoteCopyDialog } from './NoteCopyDialog';
import { copyRichNote } from '../utils/note-clipboard';
import { noteImageParts, type NoteImage } from '../utils/note-images';
import { NOTE_OPTIMIZATION_MAX_LENGTH } from '../utils/note-content';
import { removeUnboundNoteImage } from '../utils/note-image-client';
import { getStoredAuthHeaders } from '../hooks/useAuth';
import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogLifecycle } from '../hooks/useDialogLifecycle';
import { useFileDrop } from '../hooks/useFileDrop';
import { usePanelPresence } from '../hooks/usePanelPresence';
import { Check, ChevronDown, ChevronUp, CircleX, Copy, Forward, GitMerge, Sparkles, Pencil, RotateCcw, StickyNote, X } from 'lucide-react';
import { formatNotesAsCsv, formatNotesAsText, noteExportFilename } from '../utils/note-export';
import { NOTE_COLORS, NOTE_COLOR_LABELS, NOTE_COLOR_STYLES, normaliseNoteColor, type NoteColor } from '../utils/note-colors';

export interface NoteItem {
  id: string;
  content: string;
  images: NoteImage[];
  isOptimized: boolean;
  optimizationCount: number;
  contentRevision: number;
  completed: boolean;
  completedAt: string | null;
  color: NoteColor;
  /** @deprecated 仅为旧 API/备份兼容保留，界面不展示。 */
  linkedScheduleIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface NoteBoardProps {
  id?: string;
  notes: NoteItem[];
  loading: boolean;
  error: string | null;
  aiBusy: boolean;
  drawerOpen: boolean;
  onCloseDrawer: () => void;
  onToggleCompleted: (note: NoteItem) => Promise<void>;
  onEdit: (note: NoteItem, content: string, images: NoteImage[]) => Promise<void>;
  onAddImages: (note: NoteItem, files: File[]) => Promise<NoteItem>;
  onColorChange: (note: NoteItem, color: NoteColor) => Promise<void>;
  onMerge: (source: NoteItem, target: NoteItem) => Promise<void>;
  onOptimize: (note: NoteItem, signal?: AbortSignal) => Promise<NoteItem>;
  onRevertOptimization: (note: NoteItem, signal?: AbortSignal) => Promise<NoteItem>;
}

function NoteColorPicker({ note, disabled, open, onToggle, onChange }: {
  note: NoteItem & { displayIndex: number };
  disabled: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (color: NoteColor) => void;
}) {
  const color = normaliseNoteColor(note.color);
  const style = NOTE_COLOR_STYLES[color];
  return (
    <div className="note-board-color-picker">
      <button
        type="button"
        className="note-board-color-number"
        style={{ color: style.accent, backgroundColor: style.surface, borderColor: style.border }}
        onClick={onToggle}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`记事编号 ${note.displayIndex}，当前颜色：${NOTE_COLOR_LABELS[color]}，点击更换颜色`}
        title={`编号 ${note.displayIndex} · 当前颜色：${NOTE_COLOR_LABELS[color]}；点击更换`}
      >
        {note.displayIndex}
      </button>
      {open && (
        <div className="note-board-color-menu" role="menu" aria-label="选择记事颜色">
          {NOTE_COLORS.map(option => {
            const optionStyle = NOTE_COLOR_STYLES[option];
            const selected = option === color;
            return (
              <button
                key={option}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={selected ? 'is-selected' : ''}
                onClick={() => onChange(option)}
                disabled={disabled}
              >
                <span className="note-board-color-dot" style={{ backgroundColor: optionStyle.accent }} aria-hidden="true" />
                <span>{NOTE_COLOR_LABELS[option]}</span>
                {selected && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type CopyFeedback = 'success' | 'error' | null;

const NoteBody = memo(function NoteBody({ content, images }: { content: string; images: NoteImage[] }) {
  const { parts, trailing } = noteImageParts(content, images);
  return <>
    {parts.map((part, index) => typeof part === 'string'
      ? <div key={index} className="note-board-text-part"><NoteLinks text={part} /></div>
      : <div key={part.id} className="note-board-inline-image" onClick={event => event.stopPropagation()}>
        <NoteImageGallery images={[part]} />
      </div>)}
    {!!trailing.length && <div onClick={event => event.stopPropagation()}><NoteImageGallery images={trailing} /></div>}
  </>;
});

function NoteRow({
  note,
  displayIndex,
  selected,
  editing,
  editValue,
  editImages,
  editError,
  editRevision,
  onEditChange,
  onUploaded,
  onImageBusyChange,
  imageBusy,
  saving,
  colorPickerOpen,
  copyFeedback,
  mergeSourceSelected,
  mergeSourceExists,
  mergeBusy,
  optimizing,
  optimizationDisabled,
  onToggleSelected,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onChangeColor,
  onToggleCompleted,
  onMerge,
  onCopy,
  onOptimize,
  onToggleColorPicker,
  onDropImages,
}: {
  note: NoteItem & { displayIndex: number };
  displayIndex: number;
  selected: boolean;
  editing: boolean;
  editValue: string;
  editImages: NoteImage[];
  editError: string;
  editRevision: number;
  onEditChange: (content: string, images: NoteImage[]) => void;
  onUploaded: (images: NoteImage[], authorization: string | undefined) => void;
  onImageBusyChange: (busy: boolean) => void;
  imageBusy: boolean;
  saving: boolean;
  colorPickerOpen: boolean;
  copyFeedback: CopyFeedback;
  mergeSourceSelected: boolean;
  mergeSourceExists: boolean;
  mergeBusy: boolean;
  optimizing: boolean;
  optimizationDisabled: boolean;
  onToggleSelected: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onChangeColor: (color: NoteColor) => void;
  onToggleCompleted: () => void;
  onMerge: () => void;
  onCopy: () => void;
  onOptimize: () => void;
  onToggleColorPicker: () => void;
  onDropImages: (files: File[]) => Promise<void>;
}) {
  const color = normaliseNoteColor(note.color);
  const colorStyle = NOTE_COLOR_STYLES[color];
  const [uploading, setUploading] = useState(false);
  const [dropError, setDropError] = useState('');
  const uploadingRef = useRef(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    if (wasEditing.current && !editing) editButton.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);
  const disabled = saving || mergeBusy || optimizing;
  const { dragging, dropProps } = useFileDrop(disabled || uploading, files => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    setDropError('');
    void onDropImages(files).catch(error => setDropError(error instanceof Error ? error.message : '图片未能保存，请重试')).finally(() => {
      uploadingRef.current = false;
      setUploading(false);
    });
  });
  const mergeTitle = mergeSourceSelected
    ? '取消合并来源'
    : mergeSourceExists
      ? '合并到此记事'
      : '选择为合并来源';
  return (
    <article
      id={'orbit-note-'+note.id}
      data-dragging={dragging || undefined}
      {...(editing ? {} : dropProps)}
      className={`note-board-row${editing ? ' is-editing' : ''}${note.completed ? ' is-completed' : ''}${colorPickerOpen ? ' is-color-picker-open' : ''}${mergeSourceSelected ? ' is-merge-source' : ''}`}
      style={{ backgroundColor: colorStyle.surface, borderColor: colorStyle.border }}
    >
      <div className="note-board-row-toolbar" onKeyDown={event => {
        if (editing && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancelEdit();
        }
      }}>
        {editing ? <>
          <IconButton variant="quiet" size="small" className="note-board-action" onClick={onSaveEdit}
            disabled={disabled || imageBusy} title="保存修改" label={`保存记事 ${displayIndex}`}>
            <Check size={15} aria-hidden="true" />
          </IconButton>
          <IconButton variant="quiet" size="small" className="note-board-action" onClick={onCancelEdit}
            disabled={disabled} title="取消编辑" label={`取消编辑记事 ${displayIndex}`}>
            <X size={15} aria-hidden="true" />
          </IconButton>
        </> : <>
        <label className="note-board-select" title={selected ? '取消选择' : '选择记事'}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelected}
            aria-label={`${selected ? '取消选择' : '选择'}记事 ${displayIndex}`}
          />
          <span aria-hidden="true" />
        </label>
        <IconButton
          ref={editButton}
          variant="quiet"
          size="small"
          className="note-board-action"
          onClick={onStartEdit}
          disabled={disabled || uploading}
          title="编辑记事"
          label={`编辑记事 ${displayIndex}`}
        >
          <Pencil size={15} aria-hidden="true" />
        </IconButton>
        <button
          type="button"
          className="note-board-action"
          onClick={onOptimize}
          disabled={disabled || optimizationDisabled}
          aria-busy={optimizing}
          title={optimizing ? '正在处理…' : note.isOptimized ? `撤回第 ${note.optimizationCount} 次优化` : 'AI 优化'}
          aria-label={optimizing
            ? `正在处理记事 ${displayIndex}`
            : note.isOptimized
              ? `撤回记事 ${displayIndex} 第 ${note.optimizationCount} 次优化`
              : `AI 优化记事 ${displayIndex}`}
        >
          {note.isOptimized ? <RotateCcw size={15} /> : <Sparkles size={15} />}
        </button>
        <button type="button" className="note-board-action" onClick={onCopy} title={copyFeedback === 'success' ? '已复制' : copyFeedback === 'error' ? '复制失败' : '复制正文'} aria-label={`复制记事 ${displayIndex}`}>
          {copyFeedback === 'success' ? <Check size={15} /> : copyFeedback === 'error' ? <CircleX size={15} /> : <Copy size={15} />}
        </button>
        <button type="button" className="note-board-action" onClick={onToggleCompleted} disabled={disabled} title={note.completed ? '恢复到进行中' : '移入废纸篓'} aria-label={`${note.completed ? '恢复记事' : '完成记事并移入废纸篓'} ${displayIndex}`}>
          {note.completed ? <RotateCcw size={15} /> : <Forward size={15} />}
        </button>
        <button
          type="button"
          className={`note-board-action${mergeSourceSelected ? ' is-merge-source' : ''}`}
          onClick={onMerge}
          disabled={disabled}
          title={mergeTitle}
          aria-label={`${mergeTitle}：记事 ${displayIndex}`}
          aria-pressed={mergeSourceSelected}
        >
          <GitMerge size={15} />
        </button>
        </>}
      </div>

      <div className="note-board-row-content">
        {!editing && <NoteColorPicker
          note={{ ...note, displayIndex }}
          disabled={disabled}
          open={colorPickerOpen}
          onToggle={onToggleColorPicker}
          onChange={onChangeColor}
        />}
        <div className="note-board-row-text">
          {editing ? (
            <NoteEditor key={editRevision} content={editValue} images={editImages} error={editError}
              disabled={disabled} onChange={onEditChange} onSave={onSaveEdit} onCancel={onCancelEdit}
              onUploaded={onUploaded} onBusyChange={onImageBusyChange} />
          ) : (
            <div className="note-board-content-button" onClick={()=>{if(!disabled)onStartEdit();}}>
              <NoteBody content={note.content} images={note.images} />
            </div>
          )}
          {!editing && dragging && <p className="note-drop-feedback" role="status">松开，把图片添加到这条记事</p>}
          {!editing && uploading && <p className="note-drop-feedback" role="status">正在保存图片…</p>}
          {!editing && dropError && <p className="orbit-inline-error" role="alert">{dropError}</p>}
        </div>
      </div>
    </article>
  );
}

export function NoteBoard({
  id,
  notes,
  loading,
  error,
  drawerOpen,
  onCloseDrawer,
  onToggleCompleted,
  onEdit,
  onAddImages,
  onColorChange,
  onMerge,
  onOptimize,
  onRevertOptimization,
}: NoteBoardProps) {
  const [completedOpen, setCompletedOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editBase = useRef<NoteItem | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editImages, setEditImages] = useState<NoteImage[]>([]);
  const [editError, setEditError] = useState('');
  const [imageBusy, setImageBusy] = useState(false);
  const savingEdit = useRef(false);
  const mounted = useRef(false);
  const draftUploads = useRef<{ images: NoteImage[]; authorization: string | undefined } | null>(null);
  const [copyPreview, setCopyPreview] = useState<NoteItem | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{ id: string; kind: CopyFeedback }>({ id: '', kind: null });
  const [optimizationBusyId, setOptimizationBusyId] = useState<string | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1100px)').matches);
  const presence = usePanelPresence(drawerOpen);
  useDialogLifecycle(dialogRef, mobile && presence.present, '.note-board-close');
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)');
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const copyTimerRef = useRef<number | null>(null);
  const optimizationAbortRef = useRef<AbortController | null>(null);

  const discardUploads = (saved: NoteImage[] = []) => {
    const draft = draftUploads.current;
    draftUploads.current = null;
    if (draft && getStoredAuthHeaders().Authorization === draft.authorization) {
      void Promise.allSettled(draft.images.filter(image => !saved.some(item => item.id === image.id)).map(removeUnboundNoteImage));
    }
  };

  useEffect(() => {
    if (!drawerOpen || mobile) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawerRef.current?.querySelector<HTMLElement>('button, input, textarea')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) onCloseDrawer();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); previous?.isConnected && previous.focus({ preventScroll: true }); };
  }, [drawerOpen, mobile, onCloseDrawer]);

  useEffect(() => {
    setSelectedIds(new Set());
    setColorPickerId(null);
    setMergeSourceId(previous => previous && notes.some(note => note.id === previous) ? previous : null);
  }, [notes]);

  useEffect(() => {
    if (!drawerOpen) setMergeSourceId(null);
  }, [drawerOpen]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      optimizationAbortRef.current?.abort();
      if (!savingEdit.current) discardUploads();
    };
  }, []);

  const confirmation = useActionConfirmation();
  const currentEditing = useRef(editingId);currentEditing.current=editingId;
  const startEdit = (note: NoteItem) => {
    if (optimizationBusyId !== null || imageBusy || savingEdit.current) return;
    const apply = () => {
      discardUploads();
      editBase.current = note;
      setEditingId(note.id);
      setEditValue(note.content);
      setEditImages(note.images);
      setEditError('');
      setColorPickerId(null);
    };
    if (confirmation.discard(editingId !== note.id && hasUnsavedEdit, apply, '当前记事有未保存的修改，切换会丢弃修改。是否继续？')) apply();
  };

  const endEdit = (saved?: NoteImage[]) => {
    discardUploads(saved);
    if (!mounted.current) return;
    editBase.current = null;
    setEditingId(null);
    setEditValue('');
    setEditImages([]);
    setEditError('');
  };

  const saveEdit = async (note: NoteItem) => {
    const content = editValue.trim();
    if (imageBusy || savingEdit.current || optimizationBusyId === note.id) return;
    if (!content && !editImages.length) {
      setEditError('请保留文字或至少一张图片');
      return;
    }
    savingEdit.current = true;
    setEditError('');
    setSavingId(note.id);
    try {
      const base = editBase.current?.id === note.id ? editBase.current : note;
      if (hasUnsavedEdit) await onEdit(base, content, editImages);
      endEdit(editImages);
    } catch (error) {
      if (mounted.current) setEditError(error instanceof Error ? error.message : '保存记事失败，请重试');
      else discardUploads();
    } finally {
      savingEdit.current = false;
      if (mounted.current) setSavingId(null);
    }
  };

  const base = editBase.current;
  const hasUnsavedEdit = Boolean(base && (editValue !== base.content || editImages.length !== base.images.length
    || editImages.some((image, index) => image.id !== base.images[index].id || image.textOffset !== base.images[index].textOffset)));

  const runOptimization = async (note: NoteItem) => {
    if (optimizationBusyId !== null || savingEdit.current || imageBusy) return;
    if (hasUnsavedEdit) return;

    if (editingId !== note.id) {
      editBase.current = note;
      setEditingId(note.id);
      setEditValue(note.content);
      setEditImages(note.images);
      setEditError('');
      setColorPickerId(null);
    }

    const controller = new AbortController();
    optimizationAbortRef.current = controller;
    setOptimizationBusyId(note.id);
    try {
      const item = note.isOptimized
        ? await onRevertOptimization(note, controller.signal)
        : await onOptimize(note, controller.signal);
      if (currentEditing.current === note.id) {
        editBase.current = item;
        setEditValue(item.content);
        setEditImages(item.images);
      }
    } catch {
      // 父组件负责显示错误；失败时保留原正文和当前编辑态。
    } finally {
      if (optimizationAbortRef.current === controller) {
        optimizationAbortRef.current = null;
        setOptimizationBusyId(null);
      }
    }
  };

  const changeColor = async (note: NoteItem, color: NoteColor) => {
    if (normaliseNoteColor(note.color) === color) {
      setColorPickerId(null);
      return;
    }
    setSavingId(note.id);
    try {
      await onColorChange(note, color);
      setColorPickerId(null);
    } catch {
      // 父组件负责显示错误；保留色板以便重试。
    } finally {
      setSavingId(null);
    }
  };

  const copyNote = async (note: NoteItem) => {
    try {
      await copyRichNote(note.content, note.images);
      setCopyFeedback({ id: note.id, kind: 'success' });
    } catch {
      setCopyFeedback({ id: note.id, kind: 'error' });
      if (note.images.length) setCopyPreview(note);
    }
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyFeedback({ id: '', kind: null }), 1500);
  };

  const activeNotes = notes
    .filter(note => !note.completed)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const trashNotes = notes
    .filter(note => note.completed)
    .sort((left, right) => (right.completedAt || right.updatedAt).localeCompare(left.completedAt || left.updatedAt));

  const toggleSelected = (id: string) => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectSection = (sectionNotes: NoteItem[]) => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      sectionNotes.forEach(note => next.add(note.id));
      return next;
    });
  };

  const clearSection = (sectionNotes: NoteItem[]) => {
    setSelectedIds(previous => {
      const next = new Set(previous);
      sectionNotes.forEach(note => next.delete(note.id));
      return next;
    });
  };

  const downloadSection = (section: 'active' | 'trash', sectionNotes: NoteItem[], format: 'txt' | 'csv') => {
    const selected = sectionNotes.filter(note => selectedIds.has(note.id));
    if (!selected.length) return;
    const content = format === 'txt' ? formatNotesAsText(selected, section) : formatNotesAsCsv(selected, section);
    const blob = new Blob([content], { type: format === 'txt' ? 'text/plain;charset=utf-8' : 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${noteExportFilename(section)}.${format}`;
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  };

  const completeOrRestore = async (note: NoteItem) => {
    try {
      await onToggleCompleted(note);
      setSelectedIds(previous => {
        const next = new Set(previous);
        next.delete(note.id);
        return next;
      });
    } catch {
      // 父组件已显示错误，失败时保留当前选择以便继续操作。
    }
  };

  const mergeNote = async (note: NoteItem) => {
    if (mergeBusy) return;
    if (!mergeSourceId) {
      const apply = () => { endEdit(); setMergeSourceId(note.id); setColorPickerId(null); };
      if (confirmation.discard(hasUnsavedEdit, apply, '当前记事有未保存的修改，确定放弃并选择合并来源吗？')) apply();
      return;
    }
    if (mergeSourceId === note.id) {
      setMergeSourceId(null);
      return;
    }
    const source = notes.find(item => item.id === mergeSourceId);
    if (!source) {
      setMergeSourceId(null);
      return;
    }
    setMergeBusy(true);
    try {
      await onMerge(source, note);
      setMergeSourceId(null);
      setSelectedIds(previous => {
        const next = new Set(previous);
        next.delete(source.id);
        next.delete(note.id);
        return next;
      });
    } catch {
      // 父组件已显示错误；保留来源选择，便于换目标重试。
    } finally {
      setMergeBusy(false);
    }
  };

  const renderRow = (note: NoteItem, displayIndex: number) => (
    <NoteRow
      key={note.id}
      note={{ ...note, displayIndex }}
      displayIndex={displayIndex}
      selected={selectedIds.has(note.id)}
      editing={editingId === note.id}
      editValue={editingId === note.id ? editValue : note.content}
      editImages={editImages}
      editRevision={editBase.current?.contentRevision ?? note.contentRevision}
      editError={editError}
      onEditChange={(value, images) => { setEditValue(value); setEditImages(images); setEditError(''); }}
      onUploaded={(images, authorization) => {
        draftUploads.current = { images: [...(draftUploads.current?.images || []), ...images], authorization };
      }}
      onImageBusyChange={setImageBusy}
      imageBusy={imageBusy}
      saving={savingId === note.id}
      colorPickerOpen={colorPickerId === note.id}
      copyFeedback={copyFeedback.id === note.id ? copyFeedback.kind : null}
      mergeSourceSelected={mergeSourceId === note.id}
      mergeSourceExists={mergeSourceId !== null}
      mergeBusy={mergeBusy}
      optimizing={optimizationBusyId === note.id}
      optimizationDisabled={optimizationBusyId !== null || hasUnsavedEdit || !note.content.trim()
        || note.images.some(image => image.textOffset !== undefined)
        || (!note.isOptimized && note.content.length > NOTE_OPTIMIZATION_MAX_LENGTH)}
      onDropImages={async files => { await onAddImages(note, files); }}
      onToggleSelected={() => toggleSelected(note.id)}
      onStartEdit={() => startEdit(note)}
      onSaveEdit={() => { void saveEdit(note); }}
      onCancelEdit={() => { if (!savingEdit.current && optimizationBusyId !== note.id) endEdit(); }}
      onChangeColor={color => { void changeColor(note, color); }}
      onToggleCompleted={() => { void completeOrRestore(note); }}
      onMerge={() => { void mergeNote(note); }}
      onCopy={() => { void copyNote(note); }}
      onOptimize={() => { void runOptimization(note); }}
      onToggleColorPicker={() => setColorPickerId(current => current === note.id ? null : note.id)}
    />
  );

  const renderSectionTools = (section: 'active' | 'trash', sectionNotes: NoteItem[]) => {
    const selectedCount = sectionNotes.filter(note => selectedIds.has(note.id)).length;
    return (
      <div className="note-board-section-tools">
        <span>{selectedCount ? `已选 ${selectedCount}` : '未选择'}</span>
        <button type="button" onClick={() => selectSection(sectionNotes)} disabled={!sectionNotes.length}>全选</button>
        <button type="button" onClick={() => clearSection(sectionNotes)} disabled={!selectedCount}>全不选</button>
        <button type="button" onClick={() => downloadSection(section, sectionNotes, 'txt')} disabled={!selectedCount} title="仅导出文字，不包含图片">文字 TXT</button>
        <button type="button" onClick={() => downloadSection(section, sectionNotes, 'csv')} disabled={!selectedCount} title="仅导出文字，不包含图片">文字 CSV</button>
      </div>
    );
  };

  const panel = (
    <aside id={id} ref={drawerRef} className={`note-board note-board-drawer${presence.present ? ' is-open' : ''}`}
      data-phase={presence.phase} aria-label="AI 记事板">
      <div className="note-board-header">
        <div className="note-board-heading">
          <span className="note-board-heading-icon"><StickyNote size={17} /></span>
          <div>
            <strong>AI 记事板</strong>
            <span>先记下来，再决定如何安排</span>
          </div>
        </div>
        <button type="button" className="note-board-close" onClick={onCloseDrawer} aria-label="关闭记事板"><X size={17} /></button>
      </div>
      <div className="note-board-body">
        {error && <div className="note-board-error" role="alert">{error}</div>}
        {mergeSourceId && <div className="note-board-merge-hint" role="status">已选择来源记事，请点击另一张卡片的合并按钮；再次点击来源按钮可取消。复选框仍用于导出。</div>}
        {loading ? <div className="note-board-empty">正在加载记事…</div> : <>
          <section className="note-board-section">
            <div className="note-board-section-head">
              <div><strong>进行中</strong><span>{activeNotes.length}</span></div>
              {renderSectionTools('active', activeNotes)}
            </div>
            {activeNotes.length ? <div className="note-board-list">{activeNotes.map((note, index) => renderRow(note, index + 1))}</div> : <div className="note-board-section-empty">暂无进行中的记事</div>}
          </section>
          <section className="note-board-section note-board-trash-section">
            <button type="button" className="note-board-section-toggle" onClick={() => setCompletedOpen(open => !open)} aria-expanded={completedOpen}>
              <span><strong>废纸篓</strong><em>{trashNotes.length}</em></span>
              {completedOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            {completedOpen && <>
              <div className="note-board-section-head note-board-trash-tools">{renderSectionTools('trash', trashNotes)}</div>
              {trashNotes.length ? <div className="note-board-list">{trashNotes.map((note, index) => renderRow(note, index + 1))}</div> : <div className="note-board-section-empty">废纸篓是空的</div>}
            </>}
          </section>
          {notes.length === 0 && <div className="note-board-empty">还没有记事<br /><span>在输入框打开记事模式即可快速记录</span></div>}
        </>}
      </div>
      <span className="sr-only">AI 优化会在当前编辑框中锁定正文并直接保存结果；优化完成后可撤回一次，手动保存新正文会建立新的撤回基线。</span>
    </aside>
  );
  return <>{confirmation.dialog}{copyPreview && <NoteCopyDialog note={copyPreview} onClose={() => setCopyPreview(null)} />}{mobile ? createPortal(<dialog ref={dialogRef} className="orbit-note-dialog" aria-label="AI 记事板" data-phase={presence.phase}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (colorPickerId) setColorPickerId(null); else onCloseDrawer(); }}
    onClick={event => { if (event.target === event.currentTarget) onCloseDrawer(); }}>{panel}</dialog>, document.body) : panel}</>;
}
