import {Fragment} from 'react';
import {Link} from 'react-router-dom';
import {chatInline} from '../utils/chat-markdown';
function Inline({text}:{text:string}) {return <>{chatInline(text).map((part,i)=>part.type==='bold'?<strong key={i}>{part.text}</strong>:part.type==='code'?<code key={i}>{part.text}</code>:part.type==='link'?part.href!.startsWith('/')?<Link key={i} to={part.href!}>{part.text}</Link>:<a key={i} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>:<Fragment key={i}>{part.text}</Fragment>)}</>;}
export function ChatMarkdown({text}:{text:string}) {
  const lines=text.replace(/\r\n/g,'\n').split('\n'),blocks:React.ReactNode[]=[];let paragraph:string[]=[],list:string[]=[],code:string[]=[],inCode=false;
  const flush=()=>{if(paragraph.length){blocks.push(<p key={blocks.length}><Inline text={paragraph.join('\n')}/></p>);paragraph=[];}if(list.length){blocks.push(<ul key={blocks.length}>{list.map((s,i)=><li key={i}><Inline text={s}/></li>)}</ul>);list=[];}};
  for(const line of lines){if(/^```/.test(line)){flush();if(inCode){blocks.push(<pre key={blocks.length}><code>{code.join('\n')}</code></pre>);code=[];}inCode=!inCode;continue;}if(inCode){code.push(line);continue;}const h=line.match(/^#{1,3}\s+(.+)$/),li=line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+)$/);if(h){flush();blocks.push(<h3 key={blocks.length}><Inline text={h[1]}/></h3>);}else if(li){if(paragraph.length)flush();list.push(li[1]);}else if(!line.trim())flush();else{if(list.length)flush();paragraph.push(line);}}
  flush();if(code.length)blocks.push(<pre key={blocks.length}><code>{code.join('\n')}</code></pre>);
  return <div className="orbit-message-body">{blocks}</div>;
}
