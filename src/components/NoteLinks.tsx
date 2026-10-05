import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import { noteLinkPieces } from '../utils/note-links';
export function NoteLinks({text}:{text:string}) {
  return <>{noteLinkPieces(text,window.location.origin).map(({text:label,href},i)=><Fragment key={i}>{href?(href.startsWith('/')&&!/^\/tools\/[^/?]+/.test(href)?<Link to={href} onClick={e=>e.stopPropagation()}>{label}</Link>:<a href={href} target={href.startsWith('/')?undefined:'_blank'} rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>{label}</a>):label}</Fragment>)}</>;
}
