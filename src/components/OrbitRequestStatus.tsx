import { ORBIT_QUIPS, nextQuipDelay, shuffledQuips } from '../utils/orbit-quips';
import { LoaderCircle } from 'lucide-react';
import { Button } from '../ui';
import {useEffect,useRef,useState} from 'react';
import type {OrbitRequest} from '../hooks/useOrbitChat';
export function OrbitRequestStatus({request,onAction}:{request:OrbitRequest;onAction:(verb:'cancel'|'retry')=>void}) {
  const activeRequest=['queued','running'].includes(request.state);
  const bag=useRef<string[]>([]),last=useRef('');
  const [quip,setQuip]=useState('');
  const [fading,setFading]=useState(false);
  const [hidden,setHidden]=useState(document.hidden);
  useEffect(()=>{
    if(!activeRequest){setQuip('');setFading(false);return;}
    bag.current=[];
    const next=()=>{if(!bag.current.length)bag.current=shuffledQuips(last.current);last.current=bag.current.shift()!;setQuip(last.current);};
    next();let timer:ReturnType<typeof setTimeout>|undefined,fadeTimer:ReturnType<typeof setTimeout>|undefined;
    const clear=()=>{clearTimeout(timer);clearTimeout(fadeTimer);};
    const schedule=()=>{
      const delay=nextQuipDelay();
      fadeTimer=setTimeout(()=>setFading(true),delay-200);
      timer=setTimeout(()=>{next();setFading(false);schedule();},delay);
    };
    const visibility=()=>{clear();setHidden(document.hidden);setFading(false);if(!document.hidden)schedule();};
    visibility();document.addEventListener('visibilitychange',visibility);
    return()=>{clear();document.removeEventListener('visibilitychange',visibility);};
  },[request.id,activeRequest]);
  const [now,setNow]=useState(Date.now());useEffect(()=>{if(request.state!=='running')return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[request.state]);
  const step=request.steps?.find(s=>s.state==='running'),active=['queued','running'].includes(request.state),elapsed=request.createdAt?Math.max(0,Math.floor((now-Date.parse(request.createdAt))/1000)):0;
  return <div className="orbit-request" data-request-id={request.id}><div className="orbit-request-content"><strong><span className="orbit-status-dot" aria-hidden="true"/>{step?.label||({queued:'已加入队列',running:'正在处理',cancelled:'已取消',completed:'已完成',failed:'处理失败',interrupted:'已中断'} as Record<string,string>)[request.state]}{request.state==='running'&&<small> · {elapsed} 秒</small>}</strong>{activeRequest&&<div className="orbit-request-quip" data-paused={hidden || undefined} aria-label="等待俏皮话" aria-live="off">
    <LoaderCircle size={15} className="orbit-quip-loading" aria-hidden="true" />
    <div className="orbit-quip-copy"><span className="orbit-quip-text" data-fading={fading || undefined}>“{quip}”</span>
      {/* Reserve the exact tallest local quote at this width; changing text cannot move the composer. */}
      {ORBIT_QUIPS.map(text=><span className="orbit-quip-size" key={text} aria-hidden="true">“{text}”</span>)}
    </div>
  </div>}<p>{request.text}</p>{request.error&&<p role="alert">{request.error}</p>}{!!request.steps?.length&&<details><summary>处理步骤 · {request.steps.length}</summary>{request.steps.map(s=><p key={s.id}>{s.state==='completed'?'✓':s.state==='failed'?'!':'…'} {s.label}{s.query&&` · ${s.query}`}</p>)}</details>}</div>{request.state!=='completed'&&<Button onClick={()=>onAction(active?'cancel':'retry')}>{active?'取消':'重试'}</Button>}</div>;
}
