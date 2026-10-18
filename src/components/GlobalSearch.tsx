import { ArrowRight,BookOpen,CalendarDays,FileText,Search,StickyNote } from 'lucide-react';
import { useEffect,useMemo,useRef,useState } from 'react';
import { useLocation,useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ActionRow,Button,Dialog,InlineNotice,Input,LoadingState,Sheet } from '../ui';
import './shell-controls.css';


type SearchResultType = 'schedule' | 'note' | 'report' | 'library'|'conversation'|'reminder'|'setting'|'tool'|'activity-report';

interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  snippet: string;
  date?: string;
  target: { path: string };
  metadata?: Record<string, unknown>;
}

interface SearchResponse {
  results: SearchResult[];
  counts: Record<SearchResultType, number>;
}

const TYPE_LABELS: Record<SearchResultType, string> = {
  conversation:'对话',reminder:'周期提醒',setting:'设置',tool:'Tools','activity-report':'周期报告',
  schedule: '日程',
  note: '记事',
  report: '日报',
  library: '知识库',
};

const TYPE_ICONS: Record<SearchResultType, typeof CalendarDays> = {
  conversation:FileText,reminder:CalendarDays,setting:Search,tool:FileText,'activity-report':FileText,
  schedule: CalendarDays,
  note: StickyNote,
  report: FileText,
  library: BookOpen,
};

const TYPE_ORDER: SearchResultType[] = ['setting','schedule','reminder','conversation','note','report','library','tool','activity-report'];

export function GlobalSearch() {
  const navigate = useNavigate(), location = useLocation();
  const { authHeaders } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef=useRef<HTMLButtonElement>(null);
  const [mobile,setMobile]=useState(()=>window.innerWidth<768);
  useEffect(()=>{const media=window.matchMedia('(max-width:767px)'),update=()=>setMobile(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  const Overlay=mobile?Sheet:Dialog;

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const value = query.trim();
    if (!value) {
      setResponse(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ q: value, scope: 'all', limit: '40' });
        const result = await fetch(`/api/search?${params.toString()}`, { headers: authHeaders(), signal: abort.signal });
        if (!result.ok) throw new Error('搜索暂时不可用');
        const payload = await result.json() as SearchResponse;
        if (!cancelled) setResponse(payload);
      } catch (loadError) {
        if (!cancelled) {
          setResponse(null);
          setError(loadError instanceof Error ? loadError.message : '搜索暂时不可用');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [authHeaders, open, query]);

  const grouped = useMemo(() => {
    const groups = new Map<SearchResultType, SearchResult[]>();
    for (const result of response?.results || []) {
      const current = groups.get(result.type) || [];
      current.push(result);
      groups.set(result.type, current);
    }
    return groups;
  }, [response]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setResponse(null);
    setError(null);
  };

  const openResult = (result: SearchResult) => {
    close();
    if(/^\/tools\/[^/?]+/.test(result.target.path))window.location.assign(result.target.path);else navigate(result.target.path, { state: result.type === 'setting' ? { settingsReturnTo: location.pathname + location.search } : undefined });
  };

  return <>
    <Button ref={triggerRef} variant="quiet" className="global-search-trigger" onClick={()=>setOpen(true)} aria-label="打开全局搜索" aria-haspopup="dialog" leadingIcon={<Search size={18} aria-hidden="true"/>}><span className="global-search-caption">搜索 <kbd>Ctrl K</kbd></span></Button>
    <Overlay open={open} onOpenChange={next=>{if(!next)close();}} title="统一搜索" description="搜索你的事项、对话、记事、设置和报告。" initialFocus={inputRef} returnFocus={triggerRef}>
      <div className="global-search-head"><div className="global-search-input-wrap"><Input ref={inputRef} value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索事项、对话、记事、设置和报告" aria-label="搜索事项、对话、记事、设置和报告"/></div></div>
      <div className="global-search-body">{loading&&<LoadingState label="搜索中…"/>}{!query.trim()&&<p className="oui-help">输入关键词，搜索你的日程、记事、日报和知识库。</p>}{error&&<InlineNotice tone="danger" title={error}/>}
      {!error&&query.trim()&&!loading&&response&&!response.results.length&&<p role="status" className="oui-help">没有找到匹配内容。</p>}
      <div className="global-search-results">{TYPE_ORDER.map(type=>{const items=grouped.get(type)||[];if(!items.length)return null;const Icon=TYPE_ICONS[type];return <section key={type} aria-labelledby={'global-search-group-'+type}><div className="global-search-group-title" id={'global-search-group-'+type}><span><Icon size={14}/>{TYPE_LABELS[type]}</span><span>{response?.counts?.[type]||items.length}</span></div><div className="global-search-result-list">{items.map(item=><ActionRow key={item.type+item.id} onClick={()=>openResult(item)} title={item.title} description={item.snippet||'打开查看详情'} trailing={<>{item.date&&<time>{item.date.slice(0,10)}</time>}<ArrowRight size={15} aria-hidden="true"/></>}/>)}</div></section>;})}</div>
      </div>
    </Overlay>
  </>;
}
