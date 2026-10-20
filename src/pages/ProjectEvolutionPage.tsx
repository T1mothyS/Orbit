import { ReturnToToday } from '../components/ReturnToToday';
import { useEvolutionAdvance,useReducedMotion,useVisibleMotion } from '../hooks/useEvolutionMotion';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, GitCommitHorizontal, Layers, Play, Pause, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { architectureFocus, architectureGroups, storySnapshots } from '../utils/evolution-presentation';
import { APP_CONFIG } from '../config';
import { getStoredAuthHeaders } from '../hooks/useAuth';
import { architectureChanges, type EvolutionData, type EvolutionMilestone, type EvolutionSnapshot } from '../types/project-evolution';
import '../styles/project-evolution.css';
import { ActionRow, Button, IconButton, Tooltip } from '../ui';
import { UsageStatisticsView } from '../components/UsageStatisticsView';

const day = (date: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
const changes: Record<string, string> = { added: '新增', changed: '变化', removed: '移除', unchanged: '已有' };
const groups = { client: '客户端', server: '服务端', data: '数据', external: '外部集成' };
function edgePath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const right = b.x >= a.x;
  const start = a.x + (right ? 200 : 0), end = b.x + (right ? 0 : 200);
  if (a.x === b.x) return `M${start},${a.y + 33} H${start + 30} V${b.y + 33} H${b.x + 200}`;
  const lead = start + (right ? 20 : -20), tail = end + (right ? -20 : 20);
  return `M${start},${a.y + 33} H${lead} V${a.y + 80} H${tail} V${b.y + 33} H${end}`;
}

export function ProjectEvolutionPage() {
  const [params]=useSearchParams();
  return params.get('view')==='statistics'?<UsageStatisticsView/>:<ProjectEvolutionContent/>;
}
function ProjectEvolutionContent() {
  const [data, setData] = useState<EvolutionData | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [params, setParams] = useSearchParams();
  const reduced=useReducedMotion();
  const [playing,setPlaying]=useState(()=>!params.has('milestone')&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [playbackRound,setPlaybackRound]=useState(0);
  const [playbackMode, setPlaybackMode] = useState<'story' | 'history'>('story');
  const sequence = useMemo(() => data ? playbackMode === 'story' ? storySnapshots(data) : data.snapshots : [], [data, playbackMode]);
  const [autoIndex,setAutoIndex]=useState(0),[selection,setSelection]=useState(params.get('milestone')||'');
  const mapSection=useRef<HTMLElement>(null),motionVisible=useVisibleMotion(mapSection),linked=useRef(false);

  const [expandedDays, setExpandedDays] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const track = useRef<HTMLDivElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(''); setData(null);
    fetch('/api/project-evolution', { headers: getStoredAuthHeaders(), signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录后查看。' : '成长记录暂时无法加载，请重试。');
      const value = await response.json() as EvolutionData;
      if (value.schemaVersion !== 1 || !Array.isArray(value.milestones) || !Array.isArray(value.facts) || !Array.isArray(value.snapshots)) throw new Error('成长记录格式无效，请重试。');
      setData(value);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [attempt]);
  const selected = data?.milestones.find(m => m.id === params.get('milestone')) ?? data?.milestones.at(-1);
  const invalid = !!data && ((params.has('milestone') && !data.milestones.some(m => m.id === params.get('milestone'))) || (params.has('view') && !['growth', 'architecture'].includes(params.get('view')!)));
  const milestone = invalid ? data?.milestones.at(-1) : playing ? data?.milestones.find(m=>m.id===sequence[autoIndex]?.milestone) : data?.milestones.find(m=>m.id===selection)||selected;
  const select = (id:string) => {setPlaying(false);setSelection(id);setCopyStatus('');setParams({milestone:id});};
  useEffect(()=>{const id=params.get('milestone');if(id){setSelection(id);setPlaying(false);}},[params]);
  useEffect(()=>{if(reduced){setPlaying(false);setSelection(params.get('milestone')||data?.milestones.at(-1)?.id||'');}},[reduced,data]);
  useEffect(()=>{if(!data||linked.current)return;linked.current=true;const view=params.get('view');if(view==='growth'||view==='architecture')requestAnimationFrame(()=>document.getElementById(view==='growth'?'evolution-growth':'evolution-architecture')?.scrollIntoView({block:'start'}));},[data,params]);
  const fact = data?.facts.find(f => f.id === milestone?.id);
  const days = useMemo(() => {
    const result = new Map<string, EvolutionMilestone[]>();
    data?.milestones.forEach(m => { const f = data.facts.find(f => f.id === m.id); if (f) { const key = day(f.date); result.set(key, [...(result.get(key) ?? []), m]); } });
    return [...result];
  }, [data]);
  const snapshot = data?.snapshots.find(s => s.id === milestone?.snapshot);
  const snapshotIndex = data?.snapshots.findIndex(s => s.id === snapshot?.id) ?? 0;
  const sequenceIndex = sequence.findIndex(item => item.id === snapshot?.id);
  const prior = playbackMode === 'story' && sequenceIndex >= 0 ? sequence[sequenceIndex - 1] : data?.snapshots[snapshotIndex - 1];
  const additions = snapshot?.nodes.filter(n => !prior?.nodes.some(old => old.id === n.id)).length || 0;
  const pause = () => { setPlaying(false); if (milestone) setSelection(milestone.id); };
  useEvolutionAdvance(`${snapshot?.id || ''}:${playbackRound}`, playing && motionVisible, 4000 + (reduced ? 0 : 600 + Math.min(additions, 8) * 120), () => {
    if (autoIndex + 1 >= sequence.length) pause(); else setAutoIndex(index => index + 1);
  });
  const startPlayback = (index: number) => {
    setAutoIndex(index); setPlaybackRound(round => round + 1); setPlaying(true);
    const next = new URLSearchParams(params); next.delete('milestone'); setParams(next, { replace: true });
  };
  const togglePlayback = () => { if (playing) pause(); else startPlayback(sequenceIndex < 0 || sequenceIndex === sequence.length - 1 ? 0 : sequenceIndex); };
  const move = (direction: number) => {
    const list = data?.snapshots || [], target = list[Math.max(0, Math.min(list.length - 1, snapshotIndex + direction))];
    if (target) select(target.milestone);
  };


  useEffect(() => {
    if (!fact) return;
    setExpandedDays(days => days.includes(day(fact.date)) ? days : [...days, day(fact.date)]);
  }, [fact?.id]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if(playing)return;
      const container = track.current;
      const selected = container?.querySelector<HTMLElement>('.is-selected');
      if (container && selected && container.clientHeight) container.scrollTop += selected.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientHeight / 2 + selected.clientHeight / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [milestone?.id, playing]);

  return <main className="evolution-page">
    <ReturnToToday/>
    <section className="evolution-hero">
      <div><h1 ref={heading} tabIndex={-1}>从一张日历，<br />到个人信息系统。</h1><p className="evolution-intro">回看每一次能力的增加，也看清它们如何连接在一起。</p></div>
      <div className="evolution-current"><span>当前应用版本</span><strong>V{APP_CONFIG.version}</strong><p>历史收录与应用版本独立更新</p>{data && <small>收录截止提交 <code>{data.baseline.slice(0, 7)}</code><br />最早可追溯记录 {data.facts[0] ? day(data.facts[0].date) : '—'}</small>}</div>
    </section>
    {error ? <section className="evolution-state" role="alert"><h2>暂时没有读到成长记录</h2><p>{error}</p><button onClick={() => setAttempt(a => a + 1)}>重新加载</button><Link to={`/login?next=${encodeURIComponent('/project?' + params.toString())}`}>重新登录</Link></section> : !data ? <div className="evolution-state" role="status" aria-busy="true">正在读取项目历史…</div> : !milestone || !fact || !snapshot ? <div className="evolution-state" role="status">还没有可展示的里程碑。</div> : <>
      <div className="evolution-stats"><div><strong>{data.milestones.length}</strong><span>关键里程碑</span></div><div><strong>{new Set(data.milestones.flatMap(m => m.featureAreas)).size}</strong><span>能力领域</span></div><div><strong>{data.snapshots.length}</strong><span>架构快照</span></div><p>代码记录证明能力的演进。<br />生产部署与设备验收，需要各自的证据。</p></div>
      <nav className="evolution-stages" aria-label="成长阶段">{data.stages.map((stage, i) => <button key={stage} aria-pressed={milestone.stage === i} onClick={() => { const target = data.milestones.find(m => m.stage === i); if (target) select(target.id); }}><span>0{i + 1}</span>{stage}<ArrowUpRight size={14} /></button>)}</nav>
      <section id="evolution-architecture" data-playback-active={playing&&motionVisible} ref={mapSection} className="evolution-playback-section">
      <header className="evolution-playback-header"><div><h2><Layers size={21} />架构演化</h2><p>{playing ? '沿着历史，看系统逐步连接。' : '已定格，选择节点查看职责与连接。'}</p></div><div className="evolution-playback-actions">
        <span>{snapshotIndex + 1} / {data.snapshots.length}</span>
        <Tooltip content="上一快照"><IconButton label="上一快照" variant="quiet" disabled={snapshotIndex <= 0} onClick={() => move(-1)}><ChevronLeft size={17} /></IconButton></Tooltip>
        {playing ? <Tooltip content="暂停架构播放"><IconButton label="暂停架构播放" variant="quiet" onClick={togglePlayback}><Pause size={17} /></IconButton></Tooltip> : <Button variant="quiet" leadingIcon={<Play size={16} />} onClick={togglePlayback}>{reduced ? '播放历史' : '继续播放'}</Button>}
        <Tooltip content="下一快照"><IconButton label="下一快照" variant="quiet" disabled={snapshotIndex >= data.snapshots.length - 1} onClick={() => move(1)}><ChevronRight size={17} /></IconButton></Tooltip>
        <Tooltip content="重新播放"><IconButton label="重新播放" variant="quiet" onClick={() => startPlayback(0)}><RotateCcw size={16} /></IconButton></Tooltip>
      </div></header>
      <div className="evolution-playback-progress" aria-hidden="true"><span style={{ transform: `scaleX(${(snapshotIndex + 1) / data.snapshots.length})` }} /></div>
      <div className="evolution-playback-mode" role="group" aria-label="演示范围"><Button variant="quiet" aria-pressed={playbackMode === 'story'} onClick={() => { pause(); setPlaybackMode('story'); }}>精选演示 · {storySnapshots(data).length} 站</Button><Button variant="quiet" aria-pressed={playbackMode === 'history'} onClick={() => { pause(); setPlaybackMode('history'); }}>完整历史 · {data.snapshots.length} 个快照</Button><span>能力阶段可以交叉，播放顺序按历史排列</span></div>
      {invalid && <p role="status" className="evolution-notice">链接中的选择无效，已显示最新收录记录。<Button variant="quiet" onClick={() => select(milestone.id)}>重置链接</Button></p>}
      <div className="evolution-selection" onPointerDownCapture={pause} onFocusCapture={pause}><label htmlFor="evolution-milestone">当前里程碑</label><select id="evolution-milestone" value={milestone.id} onChange={e => select(e.target.value)}>{data.milestones.map(m => <option value={m.id} key={m.id}>{day(data.facts.find(f => f.id === m.id)!.date)} · {m.title}</option>)}</select></div>
      <Architecture data={data} current={snapshot} previous={prior} playing={playing&&!reduced} motionActive={motionVisible} onPause={pause} milestone={milestone}/>
      <nav className="evolution-story-stops" aria-label="精选演示停靠点">{storySnapshots(data).map((stop, index) => { const entry = data.milestones.find(m => m.id === stop.milestone)!; return <Button key={stop.id} variant="quiet" aria-pressed={snapshot.id === stop.id} onClick={() => { setPlaybackMode('story'); select(stop.milestone); }}><span>{index + 1}</span>{data.stages[entry.stage]}{index === storySnapshots(data).length - 1 ? ' · 今天' : ''}</Button>; })}</nav>
      </section>
      <section id="evolution-growth" className="evolution-growth-section"><h2>成长历程</h2>
        <div className="evolution-workbench">
        <nav className="evolution-history" aria-label="成长时间线"><h2>里程碑</h2><div className="evolution-track-scroll" ref={track} tabIndex={0} aria-label="按日期顺序排列，可纵向滚动">{days.map(([date, entries]) => {
          const expanded = entries.length === 1 || expandedDays.includes(date);
          return <div className="evolution-day" key={date}>
            {entries.length > 1 ? <Button variant="quiet" className="evolution-day-toggle" onClick={() => setExpandedDays(v => v.includes(date) ? v.filter(d => d !== date) : [...v, date])} aria-expanded={expanded}>{date} · {entries.length} 项 {expanded ? '收起' : '展开'}</Button> : <span className="evolution-day-date">{date}</span>}
            <ol className="evolution-day-items">{(expanded ? entries : [entries.find(m => m.id === milestone.id) ?? entries[entries.length - 1]]).map(m => {
              const f = data.facts.find(f => f.id === m.id)!;
              return <li className={`evolution-stop ${m.id === milestone.id ? 'is-selected' : ''}`} key={m.id}><ActionRow aria-pressed={m.id === milestone.id} onClick={() => select(m.id)} title={m.title} description={<>{f.version ? `V${f.version}` : '版本未记录'} · <code>{f.commit.slice(0, 7)}</code></>} /></li>;
            })}</ol>
          </div>;
        })}</div></nav>
        <article className="evolution-detail" aria-live={playing?'off':'polite'}><div className="evolution-detail-heading"><span className="evolution-eyebrow">{data.stages[milestone.stage]}</span><span>{day(fact.date)} · V{fact.version ?? '—'}</span></div><h2>{milestone.title}</h2><p className="evolution-summary">{milestone.summary}</p><Button variant="quiet" className="evolution-text-link" onClick={() => {pause();document.getElementById('evolution-architecture')?.scrollIntoView({block:'start',behavior:reduced?'auto':'smooth'});}}>查看这一刻的系统结构 <ArrowUpRight size={16} /></Button>
          <details><summary><GitCommitHorizontal size={17} /> 工程细节与证据</summary><p>{milestone.engineering}</p><dl><dt>实现提交</dt><dd><code>{fact.commit}</code> <button onClick={async () => { try { await navigator.clipboard.writeText(fact.commit); setCopyStatus('已复制提交哈希'); } catch { setCopyStatus('复制失败，请选择上方哈希手动复制'); } }}>复制</button><span role="status">{copyStatus}</span></dd><dt>版本依据</dt><dd>该提交的 package.json：{fact.version ?? '未记录'}；标签：{fact.tags.join('、') || '未记录'}。不据此推断发行或部署。</dd><dt>源码依据</dt><dd>{milestone.evidencePaths.join('、')}</dd><dt>验证记录</dt><dd>{milestone.tests ? `本地测试 ${milestone.tests.count} 项；${milestone.tests.evidence}` : '本地测试数量未记录'}；生产验证：本页未记录。</dd><dt>能力领域</dt><dd>{milestone.featureAreas.join(' · ')}</dd></dl>{fact.warnings.map(w => <p className="evolution-notice" key={w}>{w}</p>)}<p className="evolution-muted">历史版本保留当时原值，早期 1.0.0 与后续 0.x 不构成连续递增序列。</p></details>
        </article>
        </div>
        <Metrics data={data} selectedId={milestone.id} />
      </section>
      <footer className="evolution-footer">历史基于已收录提交整理 · 日期使用香港时区 · 页面不读取个人日程、邮件或知识内容</footer>
    </>}
  </main>;
}

function Metrics({ data, selectedId }: { data: EvolutionData; selectedId: string }) {
  const facts = new Map(data.facts.map(f => [f.id, f]));
  const series = [
    { title: '源码非空行', description: '含注释与测试；沿用源码排除规则', values: data.milestones.map(m => facts.get(m.id)!.sourceLoc) },
    { title: 'Git 跟踪文件', description: '完整 Git 文件树，不限于源码', values: data.milestones.map(m => facts.get(m.id)!.trackedFiles) },
    { title: '能力领域', description: '该里程碑明确记录的领域集合', values: data.milestones.map(m => m.featureAreas.length) },
  ];
  const records = data.milestones.filter(m => m.tests !== null);
  const selected = data.milestones.findIndex(m => m.id === selectedId);
  const milestone = data.milestones[selected];
  const metricSection = useRef<HTMLElement>(null), visible = useVisibleMotion(metricSection), reduced = useReducedMotion();
  return <section ref={metricSection} className={`evolution-metrics${visible && !reduced ? ' is-drawing' : ''}`}>
    <h2>成长的刻度</h2><p className="evolution-muted">按里程碑顺序展示，各图使用独立尺度；规模是记录，不代表质量。</p>
    <div className="evolution-metric-layout"><div className="evolution-chart-grid">{series.map(series => {
      const max = Math.max(1, ...series.values);
      const point = (n: number, i: number) => [10 + i * 260 / Math.max(1, series.values.length - 1), 85 - n / max * 65];
      return <figure key={series.title}><figcaption>{series.title}<strong>{series.values[selected]?.toLocaleString() ?? '未记录'}</strong><small>{series.description}</small></figcaption>
        <svg key={visible ? 'visible' : 'hidden'} viewBox="0 0 280 100" role="img" aria-label={`${series.title}趋势；起止日期及详细数值见数据表`}><path d="M10 85 H270" className="chart-axis" />{series.values.map((n, i) => {
          const [x, y] = point(n, i), previous = i ? point(series.values[i - 1], i - 1) : null, fact = facts.get(data.milestones[i].id)!;
          return <g key={i}>{previous && <line x1={previous[0]} y1={previous[1]} x2={x} y2={y} className="chart-line" pathLength="1" style={{ animationDelay: `${i * 15}ms` }} />}<circle cx={x} cy={y} r={i === selected ? 4 : 2.5} className="chart-dot"><title>{day(fact.date)} · V{fact.version ?? '未记录'} · {data.milestones[i].title}：{n.toLocaleString()}</title></circle></g>;
        })}</svg><div className="evolution-chart-dates"><span>{data.facts[0] && day(data.facts[0].date)}</span><span>{data.facts.at(-1) && day(data.facts.at(-1)!.date)}</span></div>
      </figure>;
    })}</div><article className="evolution-test-evidence"><h3>有记录的本地测试</h3><p><strong>已记录 {records.length}/{data.milestones.length}</strong><span>{milestone?.tests ? `本里程碑记录 ${milestone.tests.count} 项` : '本里程碑未记录'}</span></p>
      <ol>{records.map(m => { const fact = facts.get(m.id)!; return <li key={m.id} data-milestone={m.id} aria-current={m.id === selectedId ? 'true' : undefined}><div><time dateTime={fact.date}>{day(fact.date)}</time><strong>{m.tests!.count} 项</strong></div><span>V{fact.version ?? '未记录'}</span><p>{m.tests!.evidence}</p></li>; })}</ol>
      <small>未记录不等于 0。每条记录独立保留，验证范围不同，不相加或推算缺失数量。</small>
    </article></div>
    <details><summary>查看数据表与统计口径</summary><p>源码统计 src、server、electron、scripts 内支持扩展名的非空行（含注释和测试），排除依赖、构建、运行数据、压缩文件及本功能自身。文件数为完整 Git 文件树；能力领域取显式集合。规则版本：{data.metricRules}。测试数来自各提交的验证证据，未记录不补零。</p>
      <div className="evolution-table-scroll"><table><thead><tr><th>日期</th><th>版本</th><th>里程碑</th>{series.map(s => <th key={s.title}>{s.title}</th>)}<th>有记录的本地测试</th></tr></thead><tbody>{data.milestones.map((m, i) => { const fact = facts.get(m.id)!; return <tr key={m.id}><td>{day(fact.date)}</td><td>{fact.version ?? '未记录'}</td><th scope="row">{m.title}</th>{series.map(s => <td key={s.title}>{s.values[i].toLocaleString()}</td>)}<td>{m.tests?.count.toLocaleString() ?? '未记录'}</td></tr>; })}</tbody></table></div>
    </details>
  </section>;
}

function Architecture({ data, current, previous, playing, motionActive, onPause, milestone }: { data: EvolutionData; current: EvolutionSnapshot; previous?: EvolutionSnapshot; playing: boolean; motionActive: boolean; onPause: () => void; milestone: EvolutionMilestone }) {
  const diff = useMemo(() => architectureChanges(previous, current), [previous, current]);
  const [selectedNode, setSelectedNode] = useState<string>();
  const [full, setFull] = useState(false), [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null), overview = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<{ width: number; height: number; positions: Record<string, { x: number; y: number }> }>({ width: 1, height: 1, positions: {} });
  const node = diff.nodes.find(n => n.id === selectedNode);
  const focus = useMemo(() => architectureFocus(diff, selectedNode), [diff, selectedNode]);
  const projection = useMemo(() => architectureGroups(diff, selectedNode), [diff, selectedNode]);
  const newNodes = diff.nodes.filter(n => n.change === 'added');
  const origin = data.milestones.find(m => m.id === current.milestone)!;
  const first = node && data.snapshots.find(s => s.nodes.some(n => n.id === node.id));
  const firstMilestone = data.milestones.find(m => m.id === first?.milestone);
  const height = Math.max(240, ...diff.nodes.map(n => n.y + 100));
  useEffect(() => { if (!diff.nodes.some(n => n.id === selectedNode)) setSelectedNode(undefined); }, [diff, selectedNode]);
  const choose = (id: string) => { onPause(); setSelectedNode(id); };
  useLayoutEffect(() => {
    const element = overview.current; if (!element || full) return;
    const measure = () => {
      const rect = element.getBoundingClientRect(); if (!rect.width || !rect.height) return;
      const positions: Record<string, { x: number; y: number }> = {};
      element.querySelectorAll<HTMLElement>('[data-group]').forEach(item => { const bounds = item.getBoundingClientRect(); positions[item.dataset.group!] = { x: bounds.left - rect.left + bounds.width / 2, y: bounds.top - rect.top + bounds.height / 2 }; });
      setGeometry({ width: rect.width, height: rect.height, positions });
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, [full, current.id]);
  useLayoutEffect(() => {
    const element = viewport.current; if (!element || !full) return;
    const fit = () => { if (element.clientWidth && element.clientHeight) setZoom(Math.max(.95, Math.min(1, element.clientWidth / 1110, element.clientHeight / height))); };
    fit(); const observer = new ResizeObserver(fit); observer.observe(element); return () => observer.disconnect();
  }, [full, height]);
  return <section className={`evolution-architecture${playing ? ' is-playing' : ''}`} onFocusCapture={event => { if ((event.target as HTMLElement).closest('.evolution-node,.evolution-node-list,.evolution-overview-group')) onPause(); }}>
    <div className="evolution-story-layout"><div className="evolution-diagram-column"><div className="evolution-diagram-toolbar"><h3>{full ? '完整架构' : node ? `聚焦：${node.label}` : '这一刻，系统怎样连接'}</h3><Button variant="quiet" onClick={() => { onPause(); setFull(value => !value); }}>{full ? '返回概览' : '查看完整架构'}</Button></div>
      {full ? <div className="evolution-full-map"><div className="evolution-map-controls"><Button aria-label="缩小架构图" disabled={zoom <= .5} onClick={() => setZoom(z => Math.max(.5, z - .1))}>−</Button><span>{Math.round(zoom * 100)}%</span><Button aria-label="放大架构图" disabled={zoom >= 1.5} onClick={() => setZoom(z => Math.min(1.5, z + .1))}>＋</Button><Button onClick={() => { const element = viewport.current; if (element) { setZoom(Math.max(.95, Math.min(1, element.clientWidth / 1110, element.clientHeight / height))); element.scrollTo(0, 0); } }}>复位</Button></div>
        <div ref={viewport} className="evolution-map-scroll" tabIndex={0} aria-label="完整架构图，可在容器内滚动"><div style={{ width: 1110 * zoom, height: height * zoom }}><div className="evolution-map" style={{ width: 1110, height, transform: `scale(${zoom})` }}>{Object.entries(groups).map(([key, label], i) => <span className="evolution-map-group" style={{ left: [25, 300, 580, 860][i] }} key={key}>{label}</span>)}<svg width="1110" height={height} aria-hidden="true">{diff.edges.map(e => { const a = diff.nodes.find(n => n.id === e.source)!, b = diff.nodes.find(n => n.id === e.target)!; return <path key={`${current.id}:${e.id}`} data-edge={e.id} pathLength="1" style={{ animationDelay: `${Math.min(7, Math.max(0, newNodes.findIndex(n => n.id === e.source), newNodes.findIndex(n => n.id === e.target))) * 120 + 200}ms`, animationPlayState: motionActive ? 'running' : 'paused' }} className={`architecture-edge change-${e.change}${node ? focus.edges.some(item => item.id === e.id) ? ' is-related' : ' is-muted' : ''}`} d={edgePath(a, b)}><title>{a.label} → {b.label}：{changes[e.change]}</title></path>; })}</svg>{diff.nodes.map(n => <Button variant="quiet" key={n.id} data-node={n.id} style={{ left: n.x, top: n.y, animationDelay: `${Math.min(7, Math.max(0, newNodes.findIndex(item => item.id === n.id))) * 120}ms`, animationPlayState: motionActive ? 'running' : 'paused' }} className={`evolution-node change-${n.change}${node && !focus.nodes.has(n.id) ? ' is-muted' : ''}`} aria-pressed={n.id === selectedNode} onClick={() => choose(n.id)}><strong>{n.label}</strong><span>{changes[n.change]}</span></Button>)}</div></div></div><p className="evolution-muted">保留可读字号，可在完整图内滚动。缩放不改变历史坐标。</p></div>
      : <div ref={overview} className="evolution-overview" aria-label={node ? `${node.label}及直接连接概览` : '系统分组概览'}><svg className="evolution-overview-edges" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true">{projection.relations.filter((e, i, all) => e.source !== e.target && !all.slice(0, i).some(prior => prior.source === e.target && prior.target === e.source)).map(e => { const a = geometry.positions[e.source], b = geometry.positions[e.target]; if (!a || !b) return null; const reverse = projection.relations.find(item => item.source === e.target && item.target === e.source); const count = e.count + (reverse?.count || 0); const horizontal = Math.abs(a.y - b.y) < 5, mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; return <g key={e.id} className={node && !e.focused ? 'is-muted' : ''}><path className={`evolution-group-edge${e.focused ? ' is-related' : ''}`} d={horizontal ? `M${a.x},${a.y} H${b.x}` : `M${a.x},${a.y} V${mid.y} H${b.x} V${b.y}`} /><text x={mid.x} y={mid.y - 7 + (e.source === 'client' && e.target === 'external' ? -18 : e.source === 'server' && e.target === 'data' ? 12 : 0)} textAnchor="middle">{count}<title>{groups[e.source]}→{groups[e.target]}：{e.count} 条{reverse ? `；${groups[e.target]}→${groups[e.source]}：${reverse.count} 条` : ''}</title></text></g>; })}</svg>
        {projection.groups.map(group => { const related = group.nodes.filter(n => !node || focus.nodes.has(n.id)), changed = related.filter(n => n.change !== 'unchanged'), featured = (changed.length ? changed : related).slice(0, 2); return <div data-group={group.id} key={group.id} className={`evolution-overview-group${group.related ? '' : ' is-muted'}${playing && changed.some(n => n.change === 'added') ? ' has-additions' : ''}`} style={{ animationPlayState: motionActive ? 'running' : 'paused' }}><h4>{groups[group.id]}<span>{node ? `${related.length} 个相关` : `${group.nodes.length} 个模块`}</span></h4>{featured.length ? featured.map(n => <Button key={n.id} variant="quiet" aria-pressed={n.id === selectedNode} onClick={() => choose(n.id)}><span>{n.label}</span><small className={`change-${n.change}`}>{changes[n.change]}</small></Button>) : <p>此时尚无{node ? '直接关联' : '记录'}</p>}<small>{projection.relations.filter(e => e.source === group.id && e.target === group.id).reduce((sum, e) => sum + e.count, 0)} 条组内连接{related.length > featured.length ? ` · 其余 ${related.length - featured.length}` : ''}</small></div>; })}
      </div>}</div>
      <div className="evolution-story-copy"><div className="evolution-stage-title">{data.stages[milestone.stage]}</div><h2>{milestone.title}</h2><p className="evolution-story-summary">{milestone.summary}</p>
        <div className="evolution-legend">{Object.entries(changes).map(([key, label]) => <span className={`change-${key}`} key={key}>{label} {diff.nodes.filter(n => n.change === key).length}</span>)}</div><p className="evolution-comparison">快照：{origin.title}<br />{previous ? `对比：${data.milestones.find(m => m.id === previous.milestone)?.title}` : '第一个可追溯快照；新增表示此时已有证据。'}</p>
        {node && <article className="evolution-node-detail" aria-live={playing ? 'off' : 'polite'}><div className="evolution-diagram-toolbar"><h3>{node.label}</h3><Button variant="quiet" onClick={() => { onPause(); setSelectedNode(undefined); }}>清除聚焦</Button></div><p className={`change-${node.change}`}>{groups[node.group]} · {changes[node.change]}</p><p>{node.description}</p><p><strong>最早可证实：</strong>{firstMilestone?.title ?? '未记录'}</p><div className="evolution-related-list"><strong>直接连接：</strong>{focus.edges.length ? focus.edges.map(e => { const other = diff.nodes.find(n => n.id === (e.source === node.id ? e.target : e.source))!; return <Button variant="quiet" key={e.id} onClick={() => choose(other.id)}>{e.source === node.id ? '→' : '←'} {other.label}{e.label ? ` · ${e.label}` : ''}</Button>; }) : <span>无</span>}</div></article>}
        <nav className="evolution-node-list" aria-label="架构模块">{Object.entries(groups).map(([group, label]) => <div key={group}><h3>{label}</h3>{diff.nodes.filter(n => n.group === group).map(n => <Button variant="quiet" key={n.id} onClick={() => choose(n.id)} aria-pressed={selectedNode === n.id}>{n.label}<span className={`change-${n.change}`}>{changes[n.change]}</span></Button>)}</div>)}</nav>
        <p className="evolution-muted">结构与历史证据不代表外部服务已部署或设备已验收。</p>
      </div></div>
  </section>;
}
