import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { safeChatHref } from '../utils/chat-markdown';

/** Conversation prose only; structured plans, attachments and state use their own components. */
export function ChatMarkdown({ text }: { text: string }) {
  return <div className="orbit-message-body"><Markdown remarkPlugins={[remarkGfm]} skipHtml
    urlTransform={(url, key) => key === 'src' ? '' : safeChatHref(url) || ''}
    components={{
      img: ({ alt }) => <span className="orbit-blocked-image">[图片未加载{alt ? `：${alt}` : ''}]</span>,
      a: ({ href, children }) => !href ? <span>{children}</span> : href.startsWith('/') ? <Link to={href}>{children}</Link> : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      table: ({ children }) => <div className="orbit-message-table" role="region" aria-label="消息表格" tabIndex={0}><table>{children}</table></div>,
    }}>{text}</Markdown></div>;
}
