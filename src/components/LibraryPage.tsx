import { BookOpen, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { CompactFilterSheet } from './CompactFilterSheet';
import { lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ExperiencePage } from './library/ExperiencePage';
import { useAuth } from '../hooks/useAuth';
import { useReadingReturn } from '../hooks/useReadingReturn';
import { FeatureBoundary } from './FeatureBoundary';
import { DEFAULT_LIBRARY_SORT, formatTime, isLibrarySort, kindLabels, LibraryEntry, LibraryKind, LibrarySort, LibraryType, readError, sortLabels, statusLabels, typeLabels } from './library/library-shared';
import './library/library.css';

const LibraryDetailPage = lazy(() => import('./library/LibraryDetailPage').then(module => ({ default: module.LibraryDetailPage })));

function LibraryHomePage() {
  const { authHeaders, user } = useAuth();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [kind, setKind] = useState<'all' | LibraryKind>('all');
  const [type, setType] = useState<'all' | LibraryType>('all');
  const [status, setStatus] = useState<'active' | 'all' | 'draft' | 'archived'>('active');
  const [sort, setSort] = useState<LibrarySort>(DEFAULT_LIBRARY_SORT);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [pendingFilters, setPendingFilters] = useState({ kind, type, status, sort });
  const [sortPreferenceReady, setSortPreferenceReady] = useState(false);
  const [sortSaving, setSortSaving] = useState(false);
  const [preferenceError, setPreferenceError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const loadGeneration = useRef(0);
  useReadingReturn(user?.id, 'library-list', listRef, !loading && sortPreferenceReady,
    { kind, type, status }, saved => {
      setKind(saved.kind); setType(saved.type); setStatus(saved.status);
    });

  const loadPreference = useCallback(async () => {
    setSortPreferenceReady(false);
    setPreferenceError(null);
    try {
      const response = await fetch('/api/library/preferences', { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '排序偏好加载失败');
      const data = await response.json();
      const nextSort = data?.preference?.sort;
      if (!isLibrarySort(nextSort)) throw new Error('服务返回的排序偏好无效');
      setSort(nextSort);
    } catch (preferenceLoadError) {
      setSort(DEFAULT_LIBRARY_SORT);
      const message = preferenceLoadError instanceof Error ? preferenceLoadError.message : '排序偏好加载失败';
      setPreferenceError(`排序偏好加载失败，已使用默认排序：${message}`);
    } finally {
      setSortPreferenceReady(true);
    }
  }, [authHeaders]);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, kind, type, sort, pageSize: '100' });
      const response = await fetch(`/api/library?${params.toString()}`, { headers: authHeaders() });
      if (!response.ok) throw await readError(response, '知识库加载失败');
      const data = await response.json();
      if (generation !== loadGeneration.current) return;
      setEntries(data.items || []);
      setTotal(Number(data.total || 0));
    } catch (loadError) {
      if (generation === loadGeneration.current) setError(loadError instanceof Error ? loadError.message : '知识库加载失败');
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [authHeaders, kind, sort, status, type]);

  useEffect(() => { void loadPreference(); }, [loadPreference]);
  useEffect(() => { if (sortPreferenceReady) void load(); }, [load, sortPreferenceReady]);

  const saveSortPreference = async (nextSort: LibrarySort) => {
    if (!sortPreferenceReady || sortSaving) return false;
    if (nextSort === sort) return true;
    setSortSaving(true);
    setPreferenceError(null);
    try {
      const response = await fetch('/api/library/preferences', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ sort: nextSort }),
      });
      if (!response.ok) throw await readError(response, '排序偏好保存失败');
      const data = await response.json();
      const savedSort = data?.preference?.sort;
      if (!isLibrarySort(savedSort)) throw new Error('服务返回的排序偏好无效');
      setSort(savedSort);
      return true;
    } catch (preferenceSaveError) {
      const message = preferenceSaveError instanceof Error ? preferenceSaveError.message : '排序偏好保存失败';
      setPreferenceError(`排序偏好保存失败，当前仍按${sortLabels[sort]}显示：${message}`);
      return false;
    } finally {
      setSortSaving(false);
    }
  };

  const filterCount = Number(type !== 'all') + Number(kind !== 'all') + Number(status !== 'active') + Number(sort !== DEFAULT_LIBRARY_SORT);
  const filterFields = (value: typeof pendingFilters, change: (value: typeof pendingFilters) => void, disabled = false) => <>
    <label>类型<select value={value.type} disabled={disabled} onChange={event => change({ ...value, type: event.target.value as typeof type })} aria-label="筛选内容类型"><option value="all">全部类型</option>{(Object.keys(typeLabels) as LibraryType[]).map(option => <option key={option} value={option}>{typeLabels[option]}</option>)}</select></label>
    <label>形态<select value={value.kind} disabled={disabled} onChange={event => change({ ...value, kind: event.target.value as typeof kind })} aria-label="筛选内容形态"><option value="all">全部形态</option><option value="article">正式知识</option><option value="fragment">知识碎片</option></select></label>
    <label>状态<select value={value.status} disabled={disabled} onChange={event => change({ ...value, status: event.target.value as typeof status })} aria-label="筛选内容状态"><option value="active">有效内容</option><option value="draft">草稿</option><option value="archived">已归档</option><option value="all">全部状态</option></select></label>
    <label>排序<select value={value.sort} disabled={disabled} onChange={event => change({ ...value, sort: event.target.value as LibrarySort })} aria-label="知识库排序">{(Object.keys(sortLabels) as LibrarySort[]).map(option => <option key={option} value={option}>{sortLabels[option]}</option>)}</select></label>
  </>;

  return (
    <div className="library-page" ref={listRef} aria-busy={loading}>
      <header className="library-header">
        <div>
          <h1>知识库</h1>
          <p>阅读、回顾，连接你的知识。</p>
        </div>
        <div className="library-header-actions">
          <Link className="library-primary-button" to="/library/experience">记录经历</Link>
          <Link className="library-secondary-button" to="/library/settings">知识库设置</Link>
          <button type="button" className="library-secondary-button mobile-filter-trigger" disabled={!sortPreferenceReady || sortSaving} onClick={() => { setPendingFilters({ kind, type, status, sort }); setFiltersOpen(true); }}><SlidersHorizontal size={16} />筛选{filterCount > 0 && <span className="filter-count">{filterCount}</span>}</button>
        </div>
      </header>

      {preferenceError && <div className="library-notice error" role="alert">{preferenceError}<button type="button" onClick={() => void loadPreference()}>重试排序偏好</button></div>}
      {error && <div className="library-notice error" role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></div>}

      <section className="library-toolbar desktop-filters" aria-label="知识库筛选"><div className="library-filters">{filterFields({ kind, type, status, sort }, value => { setKind(value.kind); setType(value.type); setStatus(value.status); void saveSortPreference(value.sort); }, !sortPreferenceReady || sortSaving)}</div></section>
      {filtersOpen && <CompactFilterSheet title="知识库筛选" busy={sortSaving} error={preferenceError} onClose={() => setFiltersOpen(false)} onReset={() => setPendingFilters({ kind: 'all', type: 'all', status: 'active', sort: DEFAULT_LIBRARY_SORT })} onApply={() => { void saveSortPreference(pendingFilters.sort).then(success => { if (success) { setKind(pendingFilters.kind); setType(pendingFilters.type); setStatus(pendingFilters.status); setFiltersOpen(false); } }); }}>{filterFields(pendingFilters, setPendingFilters)}</CompactFilterSheet>}

      <div className="library-list-meta"><span>{loading ? '正在加载…' : `显示 ${entries.length} 条，共 ${total} 条`}</span><span>当前按{sortLabels[sort]}</span></div>
      {loading && !entries.length ? (
        <div className="library-state"><RefreshCw size={24} className="spin" /><span>正在加载知识库…</span></div>
      ) : entries.length ? (
        <div className="library-grid">
          {entries.map(entry => <LibraryCard key={entry.id} entry={entry} onOpen={() => navigate(`/library/${entry.id}`)} />)}
        </div>
      ) : (
        <div className="library-state"><BookOpen size={34} /><strong>还没有符合条件的内容</strong><span>可以记录经历，或在知识库V2项目处理材料后上传。</span></div>
      )}
    </div>
  );
}

function LibraryCard({ entry, onOpen }: { entry: LibraryEntry; onOpen: () => void }) {
  const displayTitle = entry.title || entry.summary || '未命名知识碎片';
  return (
    <article className={`library-card ${entry.kind}`}>
      <button type="button" className="library-card-open" data-reader-key={entry.id} onClick={onOpen} aria-label={`打开 ${displayTitle}`}>
        <div className="library-card-topline"><span className={`library-kind-badge ${entry.kind}`}>{kindLabels[entry.kind]}</span><span className="library-type-label">{typeLabels[entry.type]}</span></div>
        <h2>{displayTitle}</h2>
        <p>{entry.summary || '暂无摘要，打开正文查看。'}</p>
        <div className="library-card-tags">{entry.tags.slice(0, 5).map(tag => <span key={tag}>#{tag}</span>)}</div>
        <div className="library-card-footer"><span>{statusLabels[entry.status]}</span><span>{formatTime(entry.updatedAt)} <b aria-hidden="true">→</b></span></div>
      </button>
    </article>
  );
}
export function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  if (location.pathname.startsWith('/library/experience')) return <ExperiencePage />;
  return id ? <FeatureBoundary key={id} navigation={<Link className="feature-reader-back" to="/library" aria-label="返回知识库">←</Link>}><LibraryDetailPage id={id} /></FeatureBoundary> : <LibraryHomePage />;
}
