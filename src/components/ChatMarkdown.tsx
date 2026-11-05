import { useRef, useState, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '../ui';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { safeChatHref } from '../utils/chat-markdown';
import { copyNoteText } from '../utils/note-clipboard';

function ChatCodeBlock({ children }: { children: ReactNode }) {
  const code = useRef<HTMLPreElement>(null);
  const [feedback, setFeedback] = useState('');
  return <div className="orbit-chat-code">
    <div className="orbit-chat-code-actions">
      <span aria-live="polite">{feedback}</span>
      <Button variant="quiet" size="small" leadingIcon={<Copy size={14} aria-hidden="true" />} onClick={() => {
        void copyNoteText(code.current?.textContent || '').then(() => setFeedback('已复制')).catch(() => setFeedback('请选中代码后复制'));
      }}>复制代码</Button>
    </div>
    <pre ref={code} tabIndex={0} aria-label="消息代码">{children}</pre>
  </div>;
}

/** Conversation prose only; structured plans, attachments and state use their own components. */
export function ChatMarkdown({ text }: { text: string }) {
  return <div className="orbit-message-body"><Markdown remarkPlugins={[remarkGfm]} skipHtml
    urlTransform={(url, key) => key === 'src' ? '' : safeChatHref(url) || ''}
    components={{
      img: ({ alt }) => <span className="orbit-blocked-image">[图片未加载{alt ? `：${alt}` : ''}]</span>,
      a: ({ href, children }) => !href ? <span>{children}</span> : href.startsWith('/') ? <Link to={href}>{children}</Link> : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      pre: ({ children }) => <ChatCodeBlock>{children}</ChatCodeBlock>,
      table: ({ children }) => <div className="orbit-message-table" role="region" aria-label="消息表格" tabIndex={0}><table>{children}</table></div>,
    }}>{text}</Markdown></div>;
}
