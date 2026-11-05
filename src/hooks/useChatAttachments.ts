import { useEffect, useRef, useState } from 'react';
import { NOTE_IMAGE_TYPES } from '../utils/note-images';

export interface ChatFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  state: string;
  error?: string;
  sent?: boolean;
  progress?: number;
  source?: File;
}

const fileTypes: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  txt: 'text/plain', md: 'text/markdown', pdf: 'application/pdf', csv: 'text/csv',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const mimeFor = (file: File) => file.type.startsWith('image/') ? file.type : fileTypes[file.name.split('.').at(-1)?.toLowerCase() || ''] || file.type;
const supportedImages = new Set<string>(NOTE_IMAGE_TYPES);
export const isChatImage = (file: File) => supportedImages.has(mimeFor(file));

export function useChatAttachments(cid: string, authHeaders: () => Record<string, string>) {
  const [files, setFiles] = useState<ChatFile[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const latest = useRef<ChatFile[]>([]);
  const session = useRef<AbortController | null>(null);
  const uploads = useRef(new Map<string, XMLHttpRequest>());
  const update = (change: (files: ChatFile[]) => ChatFile[]) => {
    latest.current = change(latest.current);
    setFiles(latest.current);
  };

  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    update(() => []);
    setError('');
    setLoading(!!cid);
    if (cid) void fetch(`/api/orbit/conversations/${encodeURIComponent(cid)}/attachments`, {
      headers: authHeaders(), signal: controller.signal,
    }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取附件失败');
      if (!controller.signal.aborted) update(() => data.attachments.filter((file: ChatFile) => !file.sent));
    }).catch(reason => {
      if (!controller.signal.aborted) setError(reason.message);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
      for (const request of uploads.current.values()) request.abort();
      uploads.current.clear();
    };
  }, [cid, authHeaders]);

  const send = async (file: ChatFile, controller: AbortController) => {
    const active = () => !controller.signal.aborted && latest.current.some(row => row.id === file.id);
    const patch = (changes: Partial<ChatFile>) => {
      if (active()) update(rows => rows.map(row => row.id === file.id ? { ...row, ...changes } : row));
    };
    const headers = authHeaders();
    try {
      patch({ state: 'uploading', error: undefined, progress: 0 });
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file.source!);
      });
      if (!active()) return;
      const result = await new Promise<ChatFile>((resolve, reject) => {
        const req = new XMLHttpRequest();
        uploads.current.set(file.id, req);
        req.open('POST', `/api/orbit/conversations/${encodeURIComponent(cid)}/attachments`);
        req.setRequestHeader('Content-Type', 'application/json');
        for (const [key, value] of Object.entries(headers)) req.setRequestHeader(key, value);
        req.upload.onprogress = event => {
          if (event.lengthComputable) patch({ progress: Math.round(event.loaded / event.total * 100), state: event.loaded === event.total ? 'processing' : 'uploading' });
        };
        req.onerror = () => reject(new Error('上传失败，请重试'));
        req.onabort = () => reject(new Error('上传已取消'));
        req.onload = () => {
          try {
            const data = JSON.parse(req.responseText);
            if (req.status >= 200 && req.status < 300) resolve(data.attachment);
            else reject(new Error(data.error || '附件上传失败'));
          } catch { reject(new Error('附件响应格式不正确')); }
        };
        req.timeout = 60000;
        req.ontimeout = () => reject(new Error('上传超时，请重试'));
        req.send(JSON.stringify({ requestId: file.id, name: file.name, mime: file.mime, base64 }));
      });
      if (active()) update(rows => rows.map(row => row.id === file.id ? result : row));
    } catch (reason) {
      patch({ state: 'local-failed', error: reason instanceof Error ? reason.message : '上传失败' });
    } finally {
      uploads.current.delete(file.id);
    }
  };

  const upload = async (selected: File[]) => {
    const controller = session.current;
    if (!cid || loading || !controller || !selected.length) return;
    if (selected.some(file => !file.size || file.size > 10 * 1024 * 1024)) {
      setError('单个附件必须在 1 字节到 10MB 之间');
      return;
    }
    const next = selected.map(source => ({
      id: crypto.randomUUID(), name: source.name || '粘贴的图片', mime: mimeFor(source),
      size: source.size, state: 'uploading', progress: 0, source,
    }));
    const pending = [...latest.current, ...next];
    if (pending.length > 3 || pending.reduce((size, file) => size + file.size, 0) > 20 * 1024 * 1024) {
      setError('每轮最多 3 个附件，总计 20MB');
      return;
    }
    setError('');
    update(() => pending);
    await Promise.all(next.map(file => send(file, controller)));
  };

  const remove = async (id: string) => {
    const controller = session.current;
    const file = latest.current.find(row => row.id === id);
    if (!controller || !file) return;
    setError('');
    if (file.source) {
      update(rows => rows.filter(row => row.id !== id));
      uploads.current.get(id)?.abort();
    }
    try {
      const response = await fetch(`/api/orbit/attachments/${encodeURIComponent(id)}`, {
        method: 'DELETE', headers: authHeaders(), signal: controller.signal,
      });
      if (!response.ok && !file.source) throw new Error((await response.json()).error || '移除失败');
      if (!controller.signal.aborted) update(rows => rows.filter(row => row.id !== id));
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '移除失败');
    }
  };

  const retry = async (id: string) => {
    const controller = session.current;
    const file = latest.current.find(row => row.id === id);
    if (!controller || !file || !['failed', 'local-failed'].includes(file.state)) return;
    setError('');
    if (file.source) return send(file, controller);
    const patch = (changes: Partial<ChatFile>) => {
      if (!controller.signal.aborted) update(rows => rows.map(row => row.id === id ? { ...row, ...changes } : row));
    };
    patch({ state: 'processing', error: undefined });
    try {
      const response = await fetch(`/api/orbit/attachments/${encodeURIComponent(id)}/retry`, {
        method: 'POST', headers: authHeaders(), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '解析失败');
      patch(data.attachment);
    } catch (reason) {
      patch({ state: 'failed', error: reason instanceof Error ? reason.message : '解析失败' });
    }
  };
  return { files, error, upload, remove, retry, loading, clear: () => update(() => []), ready: !loading && files.every(file => file.state === 'ready') };
}
