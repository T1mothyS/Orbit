import { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { baseKeymap } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { Fragment, Schema, type Node as EditorNode } from 'prosemirror-model';
import { EditorState, Selection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { getStoredAuthHeaders } from '../hooks/useAuth';
import { fetchNoteImage, removeUnboundNoteImage, uploadNoteImage } from '../utils/note-image-client';
import { NOTE_IMAGE_MAX_BYTES, NOTE_IMAGE_MAX_COUNT, NOTE_IMAGES_MAX_BYTES, NOTE_IMAGE_TYPES, noteImageParts, type NoteImage } from '../utils/note-images';
import { NoteImageInput } from './NoteImages';
import { Button } from '../ui';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'text*',
      whitespace: 'pre',
      parseDOM: [{ tag: 'p', preserveWhitespace: 'full' }],
      toDOM: () => ['p', 0],
    },
    text: {},
    note_image: {
      group: 'block',
      atom: true,
      draggable: true,
      attrs: { image: {} },
      toDOM: node => ['figure', { 'aria-label': node.attrs.image.name }],
    },
  },
});

function paragraph(text: string) {
  return schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined);
}

function imageNode(image: NoteImage) {
  return schema.nodes.note_image.create({ image });
}

function createDocument(content: string, images: NoteImage[]) {
  const { parts, trailing } = noteImageParts(content, images);
  const blocks = [...parts, ...trailing].map(part => typeof part === 'string' ? paragraph(part) : imageNode(part));
  if (!blocks.length || blocks[0].type === schema.nodes.note_image) blocks.unshift(paragraph(''));
  if (blocks.at(-1)?.type === schema.nodes.note_image) blocks.push(paragraph(''));
  return schema.nodes.doc.create(null, blocks);
}

function readDocument(doc: EditorNode) {
  let raw = '';
  const placements: Array<{ image: NoteImage; offset: number }> = [];
  let afterText = false;
  doc.forEach(node => {
    if (node.type === schema.nodes.note_image) {
      placements.push({ image: node.attrs.image, offset: raw.length });
      afterText = false;
    } else {
      if (afterText) raw += '\n';
      raw += node.textContent;
      afterText = true;
    }
  });

  const leading = raw.length - raw.trimStart().length;
  const content = raw.trim();
  const images = placements.map(({ image, offset }) => ({
    ...image,
    textOffset: image.textOffset === undefined && offset === raw.length
      ? undefined
      : Math.min(content.length, Math.max(0, offset - leading)),
  }));
  return { content, images };
}

function insertImages(view: EditorView, position: number, images: NoteImage[]) {
  const { doc } = view.state;
  const point = doc.resolve(position);
  const blocks = images.map(image => imageNode({ ...image, textOffset: 0 }));
  const imageSize = blocks.reduce((size, block) => size + block.nodeSize, 0);
  const transaction = view.state.tr;
  let next: number;
  if (point.parent.type === schema.nodes.paragraph) {
    const before = point.parent.content.cut(0, point.parentOffset);
    const after = point.parent.content.cut(point.parentOffset);
    transaction.replaceWith(point.before(), point.after(), [
      schema.nodes.paragraph.create(null, before),
      ...blocks,
      schema.nodes.paragraph.create(null, after),
    ]);
    next = point.before() + before.size + 2 + imageSize + 1;
  } else {
    if (point.nodeAfter?.type !== schema.nodes.paragraph) blocks.push(paragraph(''));
    transaction.insert(position, Fragment.fromArray(blocks));
    next = position + imageSize + 1;
  }
  transaction.setSelection(Selection.near(transaction.doc.resolve(next)));
  view.dispatch(transaction.scrollIntoView());
  view.focus();
}

interface NoteEditorProps {
  content: string;
  images: NoteImage[];
  disabled: boolean;
  error: string;
  onChange: (content: string, images: NoteImage[]) => void;
  onSave: () => void;
  onCancel: () => void;
  onBusyChange: (busy: boolean) => void;
  onUploaded: (images: NoteImage[], authorization: string | undefined) => void;
}

export function NoteEditor(props: NoteEditorProps) {
  const { disabled, error } = props;
  const latest = useRef(props);
  latest.current = props;
  const mount = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<{ view: EditorView; position: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const add = async (files: File[], position: number) => {
    const view = viewRef.current;
    if (!view || pending.current || latest.current.disabled || !files.length) return;
    setUploadError('');
    const { images } = readDocument(view.state.doc);
    if (files.some(file => !NOTE_IMAGE_TYPES.some(mime => mime === file.type) || !file.size || file.size > NOTE_IMAGE_MAX_BYTES)) {
      setUploadError('请选择 10MB 以内的 JPEG、PNG 或 WebP 图片');
      return;
    }
    if (files.length + images.length > NOTE_IMAGE_MAX_COUNT
      || [...images, ...files].reduce((sum, image) => sum + image.size, 0) > NOTE_IMAGES_MAX_BYTES) {
      setUploadError('每条记事最多 3 张图片，合计不超过 20MB');
      return;
    }
    const authorization = getStoredAuthHeaders().Authorization;
    const active = () => viewRef.current === view && getStoredAuthHeaders().Authorization === authorization;
    const operation = { view, position };
    const added: NoteImage[] = [];
    pending.current = operation;
    setUploading(true);
    latest.current.onBusyChange(true);
    try {
      for (const file of files) {
        if (!active()) break;
        added.push(await uploadNoteImage(file));
      }
      if (!active()) return;
      insertImages(view, operation.position, added);
      latest.current.onUploaded([...added], authorization);
      added.length = 0;
    } catch (reason) {
      if (active()) setUploadError(reason instanceof Error ? reason.message : '图片上传失败，请重试');
    } finally {
      if (getStoredAuthHeaders().Authorization === authorization) {
        void Promise.allSettled(added.map(removeUnboundNoteImage));
      }
      if (pending.current === operation) {
        pending.current = null;
        setUploading(false);
        latest.current.onBusyChange(false);
      }
    }
  };
  const addRef = useRef(add);
  addRef.current = add;

  useEffect(() => {
    if (!mount.current) return;
    const initial = latest.current;
    const view = new EditorView(mount.current, {
      state: EditorState.create({
        doc: createDocument(initial.content, initial.images),
        plugins: [history(), keymap({
          Enter: (state, dispatch) => { dispatch?.(state.tr.insertText('\n')); return true; },
          'Shift-Enter': (state, dispatch) => { dispatch?.(state.tr.insertText('\n')); return true; },
          'Mod-z': undo,
          'Shift-Mod-z': redo,
          'Mod-y': redo,
        }), keymap(baseKeymap)],
      }),
      attributes: () => ({
        role: 'textbox', 'aria-label': '编辑记事正文', 'aria-multiline': 'true',
        'aria-disabled': String(latest.current.disabled),
      }),
      editable: () => !latest.current.disabled,
      dragCopies: () => false,
      dispatchTransaction(transaction) {
        if (pending.current?.view === view) pending.current.position = transaction.mapping.map(pending.current.position);
        view.updateState(view.state.apply(transaction));
        if (transaction.docChanged) {
          const next = readDocument(view.state.doc);
          latest.current.onChange(next.content, next.images);
        }
      },
      handleKeyDown(editor, event) {
        if (event.isComposing || editor.composing) return false;
        if (event.key === 'Escape') {
          event.stopPropagation();
          latest.current.onCancel();
          return true;
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          latest.current.onSave();
          return true;
        }
        return false;
      },
      handlePaste(editor, event) {
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;
        editor.dispatch(editor.state.tr.insertText(text.replace(/\r\n?/g, '\n')).scrollIntoView());
        return true;
      },
      handleDOMEvents: {
        dragover(editor, event) {
          const files = event.dataTransfer?.types.includes('Files');
          if (!files && !editor.dragging) return false;
          if (files) {
            event.preventDefault();
            event.stopPropagation();
          }
          const canDrop = !latest.current.disabled && !pending.current;
          if (files && event.dataTransfer) event.dataTransfer.dropEffect = canDrop ? 'copy' : 'none';
          const position = canDrop ? editor.posAtCoords({ left: event.clientX, top: event.clientY }) : null;
          if (position && marker.current && mount.current) {
            const caret = editor.coordsAtPos(position.pos);
            const bounds = mount.current.getBoundingClientRect();
            marker.current.style.left = `${caret.left - bounds.left}px`;
            marker.current.style.top = `${caret.top - bounds.top}px`;
            marker.current.style.height = `${Math.max(12, caret.bottom - caret.top)}px`;
          }
          if (marker.current) marker.current.hidden = !position;
          return Boolean(files);
        },
        dragleave(editor, event) {
          if (marker.current && !(event.relatedTarget instanceof Node && editor.dom.contains(event.relatedTarget))) marker.current.hidden = true;
          return false;
        },
        drop(editor, event) {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (marker.current) marker.current.hidden = true;
          if (!files.length) return false;
          event.preventDefault();
          event.stopPropagation();
          const position = editor.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? editor.state.selection.head;
          void addRef.current(files, position);
          return true;
        },
      },
      nodeViews: {
        note_image(node, editor, getPos) {
          const image: NoteImage = node.attrs.image;
          const dom = document.createElement('figure');
          dom.contentEditable = 'false';
          dom.className = 'note-editor-image';
          const thumbnail = document.createElement('img');
          thumbnail.alt = image.name;
          thumbnail.draggable = false;
          const status = document.createElement('span');
          status.textContent = '读取图片…';
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.textContent = '移除';
          remove.setAttribute('aria-label', `移除图片 ${image.name}`);
          remove.onclick = () => {
            const pos = getPos();
            if (!latest.current.disabled && pos !== undefined) {
              const before = editor.state.doc.resolve(pos).nodeBefore;
              const after = editor.state.doc.resolve(pos + node.nodeSize).nodeAfter;
              const tr = editor.state.tr;
              if (before?.type === schema.nodes.paragraph && after?.type === schema.nodes.paragraph) {
                tr.replaceWith(pos - before.nodeSize, pos + node.nodeSize + after.nodeSize, paragraph(before.textContent + after.textContent));
              } else {
                tr.delete(pos, pos + node.nodeSize);
              }
              editor.dispatch(tr);
              editor.focus();
            }
          };
          dom.append(thumbnail, status, remove);
          let url: string | undefined;
          let alive = true;
          void fetchNoteImage(image).then(blob => {
            if (!alive) return;
            url = URL.createObjectURL(blob);
            thumbnail.src = url;
            status.remove();
          }).catch(() => { if (alive) status.textContent = '图片无法读取'; });
          return {
            dom,
            stopEvent: event => event.target === remove,
            destroy() {
              alive = false;
              if (url) URL.revokeObjectURL(url);
            },
          };
        },
      },
    });
    viewRef.current = view;
    view.focus();
    return () => {
      viewRef.current = null;
      if (pending.current?.view === view) {
        pending.current = null;
        latest.current.onBusyChange(false);
      }
      view.destroy();
    };
  }, []);

  useEffect(() => {
    viewRef.current?.setProps({ editable: () => !disabled });
  }, [disabled]);

  return <>
    <div className="note-editor-surface">
      <div ref={mount} className="note-board-edit-input" />
      <div ref={marker} className="note-editor-drop-caret" hidden />
    </div>
    <div className="note-image-editor">
      <NoteImageInput inputRef={input} disabled={disabled || uploading} onFiles={files => {
        const position = viewRef.current?.state.selection.head;
        if (position !== undefined) void add(files, position);
      }} />
      <Button size="small" leadingIcon={<ImagePlus size={16} />} disabled={disabled || uploading || props.images.length >= NOTE_IMAGE_MAX_COUNT} onClick={() => input.current?.click()}>
        添加图片
      </Button>
      {uploading && <span role="status">正在上传图片…</span>}
      {(error || uploadError) && <p className="orbit-inline-error" role="alert">{error || uploadError}</p>}
    </div>
  </>;
}
