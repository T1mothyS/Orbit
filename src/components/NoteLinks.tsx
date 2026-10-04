import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { safeOrbitLink } from '../utils/orbit-links';
export function NoteLinks({text}:{text:string}) {
  const pieces:React.ReactNode[]=[];let start=0;
  const pattern=/\[([^\]\n]+)\]\(([^\s)]+)\)|https?:\/\/[^\s<>]+|\/(?:assistant|schedule|reminders|project|reports|library|tools)(?:[/?][^\s<>]*)?/g;
  for(const match of text.matchAll(pattern)){const at=match.index!;if(at>start)pieces.push(text.slice(start,at));const raw=(match[2]||match[0]).replace(/[。，；！？、）]+$/u,'');const href=safeOrbitLink(raw,window.location.origin);const label=match[1]||raw;pieces.push(href?(href.startsWith('/')&&!/^\/tools\/[^/?]+/.test(href)?<Link key={at} to={href} onClick={e=>e.stopPropagation()}>{label}</Link>:<a key={at} href={href} target={href.startsWith('/')?undefined:'_blank'} rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>{label}</a>):match[0]);if(!match[1]&&raw.length<match[0].length)pieces.push(match[0].slice(raw.length));start=at+match[0].length;}
  if(start<text.length)pieces.push(text.slice(start));return <>{pieces.map((part,i)=><Fragment key={i}>{part}</Fragment>)}</>;
}
