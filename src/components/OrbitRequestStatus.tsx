import { shuffledQuips } from '../utils/orbit-quips';
import { Button, IconButton, Tooltip, TooltipProvider } from '../ui';
import { Square, LoaderCircle, Check, CircleAlert, Minus } from 'lucide-react';
import { ChatMarkdown } from './ChatMarkdown';
import {useEffect,useRef,useState} from 'react';
import type {OrbitRequest} from '../hooks/useOrbitChat';
export function OrbitRequestStatus({request,onAction}:{request:OrbitRequest;onAction:(verb:'cancel'|'retry'|'continue')=>Promise<void>|void}) {
  const activeRequest=['queued','running'].includes(request.state);
  const bag=useRef<string[]>([]),last=useRef('');
  const [quip,setQuip]=useState('');
  useEffect(()=>{
    if(!activeRequest){setQuip('');return;}
    bag.current=[];
    const next=()=>{if(!bag.current.length)bag.current=shuffledQuips(last.current);last.current=bag.current.shift()!;setQuip(last.current);};
    next();let timer:ReturnType<typeof setInterval>|undefined;
    const visibility=()=>{clearInterval(timer);timer=undefined;if(!document.hidden)timer=setInterval(next,3000);};
    visibility();document.addEventListener('visibilitychange',visibility);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visibility);};
  },[request.id,activeRequest]);
  const [busy,setBusy]=useState(false),busyRef=useRef(false),[actionError,setActionError]=useState('');
  const act=async(verb:'cancel'|'retry'|'continue')=>{
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setActionError('');
    try{await onAction(verb);}catch(error){setActionError(error instanceof Error?error.message:'操作未完成，请重试。');}
    finally{busyRef.current=false;setBusy(false);}
  };
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(request.state!=='running')return;setNow(Date.now());const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[request.state,request.startedAt]);
  const step=request.state==='running'?request.steps?.find(s=>s.state==='running'):undefined;
  const started=request.startedAt?Date.parse(request.startedAt):now;
  const elapsed=Math.max(0,Math.floor((now-started)/1000));
  const label=({queued:'已加入队列',running:'正在处理',cancelled:'已停止',completed:'已完成',failed:'处理失败',interrupted:'已中断',partial:'已取得部分资料'} as Record<string,string>)[request.state]||'状态更新中';
  const failed=['failed','interrupted'].includes(request.state);
  const Icon=activeRequest?LoaderCircle:failed?CircleAlert:request.state==='completed'?Check:Minus;
  return <div className="orbit-request" data-request-id={request.id} data-state={request.state} aria-busy={activeRequest||undefined}>
    <div className="orbit-request-content">
      <div className="orbit-request-header">
        <strong role="status">{step?.label||label}</strong>
        {request.state==='running'&&<time className="orbit-request-elapsed" aria-label={`已运行 ${elapsed} 秒`}>{elapsed} 秒</time>}
        <div className="orbit-request-actions">
          {activeRequest?<TooltipProvider><Tooltip content={request.state==='queued'?'取消排队':'停止生成'}><IconButton label={request.state==='queued'?'取消排队':'停止生成'} variant="quiet" className="orbit-stop-button" disabled={busy} onClick={()=>void act('cancel')}><Square size={14} fill="currentColor" aria-hidden="true"/></IconButton></Tooltip></TooltipProvider>
            :failed?<Button size="small" disabled={busy} onClick={()=>void act('retry')}>{busy?'正在重试…':'重试'}</Button>
            :request.canContinue?<Button size="small" disabled={busy} onClick={()=>void act('continue')}>{busy?'正在继续…':'继续查询'}</Button>:null}
        </div>
      </div>
      {activeRequest&&<p className="orbit-request-quip" aria-live="off"><Icon className="oui-spinner" size={14} aria-hidden="true"/><span>{quip}</span></p>}
      {request.state==='partial'&&request.partialReply&&<ChatMarkdown text={request.partialReply}/>}
      {failed&&<p className="orbit-request-error" role="alert">{request.errorInfo?.message||'本次处理未完成，请重试。'}</p>}
      {request.state==='partial'&&<p className="orbit-request-notice">本次查询尚未完成；已取得的资料保留在下方。</p>}
      {actionError&&<p className="orbit-request-error" role="alert">{actionError}</p>}
      {(!!request.steps?.length||!!request.errorInfo||!!request.evidence?.length)&&<details className="orbit-request-details"><summary>处理详情{request.steps?.length?` · ${request.steps.length} 步`:''}</summary>
        {request.steps?.map(s=><p key={s.id}>{s.label} · {({completed:'完成',failed:'失败',running:'未完成'} as Record<string,string>)[s.state]||s.state}{s.query&&` · ${s.query}`}</p>)}
        {request.evidence?.map((e,i)=><details key={i}><summary>{e.tool} · {Object.values(e.args).join(' · ')}</summary><pre>{e.data}</pre></details>)}
        {request.errorInfo&&<p>诊断编号：{request.errorInfo.requestId||request.id} · {request.errorInfo.code} · {request.errorInfo.stage}</p>}
      </details>}
    </div>
  </div>;
}
