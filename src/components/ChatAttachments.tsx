import { useEffect, useRef, useState, type RefObject } from 'react';
import { Paperclip, X, FileText } from 'lucide-react';
import { Button, IconButton, Input } from '../ui';
import type { ChatFile } from '../hooks/useChatAttachments';

function ChatThumbnail({ file, authHeaders }: { file: ChatFile; authHeaders: () => Record<string, string> }) {
  const [url, setUrl] = useState('');
  const { id, source, mime, state } = file;
  useEffect(() => {
    setUrl('');
    if (!mime.startsWith('image/')) return;
    const controller = new AbortController();
    let allocated = '';
    const show = (blob: Blob) => {
      if (controller.signal.aborted) return;
      allocated = URL.createObjectURL(blob);
      setUrl(allocated);
    };
    if (source) show(source);
    else if (state === 'ready') void fetch(`/api/orbit/attachments/${encodeURIComponent(id)}`, {
      headers: authHeaders(), signal: controller.signal,
    }).then(async response => { if (response.ok) show(await response.blob()); }).catch(() => undefined);
    return () => {
      controller.abort();
      if (allocated) URL.revokeObjectURL(allocated);
    };
  }, [id, source, mime, state === 'ready', authHeaders]);
  return url ? <img src={url} alt="" /> : <FileText size={20} aria-hidden="true" />;
}

export function ChatAttachmentCard({ file, authHeaders }: { file: ChatFile; authHeaders: () => Record<string, string> }) {
  const [error, setError] = useState('');
  const download = async () => {
    setError('');
    try {
      const response = await fetch(`/api/orbit/attachments/${encodeURIComponent(file.id)}`, { headers: authHeaders() });
      if (!response.ok) throw new Error('附件已删除或无法读取');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '下载失败'); }
  };
  return <div className="orbit-file-card">
    <ChatThumbnail file={file} authHeaders={authHeaders} />
    <div><strong>{file.name}</strong><small>{file.mime.split('/')[1]?.toUpperCase().slice(0, 8)} · {(file.size / 1024).toFixed(1)} KB</small></div>
    <Button variant="quiet" onClick={() => void download()} aria-label={`下载附件 ${file.name}`}>下载</Button>
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function ChatAttachmentComposer({ files, error, upload, remove, retry, disabled, inputRef, showAddButton = true, authHeaders }: {
  files: ChatFile[];
  error: string;
  upload: (files: File[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  disabled?: boolean;
  inputRef?: RefObject<HTMLInputElement>;
  showAddButton?: boolean;
  authHeaders: () => Record<string, string>;
}) {
  const localInput = useRef<HTMLInputElement>(null);
  const input = inputRef || localInput;
  return <>
    <Input ref={input} type="file" hidden disabled={disabled} multiple accept=".jpg,.jpeg,.png,.webp,.txt,.md,.pdf,.docx,.xlsx,.csv" onChange={event => {
      const selected = Array.from(event.target.files || []);
      event.target.value = '';
      void upload(selected);
    }} />
    {(showAddButton || files.length > 0 || error) && <div className="orbit-attachments-composer">
      {showAddButton && <Button variant="quiet" disabled={disabled || files.length >= 3} onClick={() => input.current?.click()} aria-label="添加图片或文件" leadingIcon={<Paperclip size={15} aria-hidden="true" />}>附件</Button>}
      {files.map(file => <div className="orbit-draft-file" key={file.id}>
        <ChatThumbnail file={file} authHeaders={authHeaders} />
        <div><strong title={file.name}>{file.name}</strong>
          <small role={file.error ? 'alert' : undefined}>{file.state === 'uploading' ? `上传 ${file.progress || 0}%` : file.state === 'processing' ? '处理中…' : file.state === 'ready' ? '待发送' : file.error || '上传失败'}</small>
        </div>
        {['failed', 'local-failed'].includes(file.state) && <Button variant="quiet" disabled={disabled} onClick={() => void retry(file.id)}>重试</Button>}
        <IconButton variant="quiet" disabled={disabled} label={`移除附件 ${file.name}`} onClick={() => void remove(file.id)}><X size={16} aria-hidden="true" /></IconButton>
      </div>)}
      {error && <p role="alert" className="orbit-inline-error">{error}</p>}
    </div>}
  </>;
}
