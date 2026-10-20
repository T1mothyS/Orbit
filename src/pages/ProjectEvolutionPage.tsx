import { OrbitSegmentedControl } from "../components/OrbitSegmentedControl";
import { EvolutionTimeline } from "../components/EvolutionTimeline";
import { ReturnToToday } from '../components/ReturnToToday';
import { useEvolutionAdvance,useReducedMotion,useVisibleMotion } from '../hooks/useEvolutionMotion';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Layers, Play, Pause, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { architectureFocus, architectureGroups, storySnapshots, evolutionSequence, relationChange, overviewRelationPath, type OverviewBounds } from '../utils/evolution-presentation';
import { APP_CONFIG } from '../config';
import { getStoredAuthHeaders } from '../hooks/useAuth';
import { architectureChanges, type EvolutionData, type EvolutionMilestone, type EvolutionSnapshot } from '../types/project-evolution';
import '../styles/project-evolution.css';
import { Button, IconButton, Tooltip } from '../ui';
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
  const [data, setData] = useState<EvolutionData | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [params, setParams] = useSearchParams(), reduced = useReducedMotion();
  const [playing, setPlaying] = useState(() => !params.has('milestone') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [playbackMode, setPlaybackMode] = useState<'story' | 'history'>(params.has('milestone') ? 'history' : 'story');
  const [autoIndex, setAutoIndex] = useState(0), [selection, setSelection] = useState(params.get('milestone') || ''), [playbackRound, setPlaybackRound] = useState(0);
  const [copyStatus, setCopyStatus] = useState(''), [evidenceOpen, setEvidenceOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), mapSection = useRef<HTMLElement>(null), linked = useRef(false);
  const motionVisible = useVisibleMotion(mapSection);
  const sequence = useMemo(() => data ? evolutionSequence(data, playbackMode) : [], [data, playbackMode]);
  const important = useMemo(() => new Set(data ? storySnapshots(data).map(snapshot => snapshot.milestone) : []), [data]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const controller = new AbortController(); setError(''); setData(null);
    fetch('/api/project-evolution', { headers: getStoredAuthHeaders(), signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(response.status === 401 ? '登录已失效，请重新登录后查看。' : '成长记录暂时无法加载，请重试。');
      const value = await response.json() as EvolutionData;
      if (value.schemaVersion !== 1 || !Array.isArray(value.milestones) || !Array.isArray(value.facts) || !Array.isArray(value.snapshots)) throw new Error('成长记录格式无效，请重试。');
      setData(value);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [attempt]);
  const invalid = !!data && ((params.has('milestone') && !data.milestones.some(m => m.id === params.get('milestone'))) || (params.has('view') && !['growth', 'architecture'].includes(params.get('view')!)));
  const milestone = invalid ? data?.milestones.at(-1) : playing ? sequence[autoIndex] : data?.milestones.find(m => m.id === selection) || data?.milestones.find(m => m.id === params.get('milestone')) || data?.milestones.at(-1);
  const index = data?.milestones.findIndex(item => item.id === milestone?.id) ?? -1;
  const fact = data?.facts.find(item => item.id === milestone?.id), snapshot = data?.snapshots.find(item => item.id === milestone?.snapshot);
  const sequenceIndex = sequence.findIndex(item => item.id === milestone?.id);
  const previousMilestone = playbackMode === 'story' && sequenceIndex >= 0 ? sequence[sequenceIndex - 1] : data?.milestones[index - 1];
  const prior = data?.snapshots.find(item => item.id === previousMilestone?.snapshot);
  const select = (id: string) => { setPlaying(false); setPlaybackMode('history'); setSelection(id); setCopyStatus(''); setParams({ milestone: id }); };
  const pause = () => { if (playing && milestone) setSelection(milestone.id); setPlaying(false); };
  useEffect(() => { const id = params.get('milestone'); if (id) { setSelection(id); setPlaying(false); setPlaybackMode('history'); } }, [params]);
  useEffect(() => { if (reduced) { setPlaying(false); setSelection(params.get('milestone') || data?.milestones.at(-1)?.id || ''); } }, [reduced, data]);
  useEffect(() => {
    if (!data || linked.current) return; linked.current = true;
    const view = params.get('view'); if (view === 'growth' || view === 'architecture') requestAnimationFrame(() => document.getElementById('evolution-architecture')?.scrollIntoView({ block: 'start' }));
  }, [data, params]);
  const additions = snapshot?.nodes.filter(node => !prior?.nodes.some(old => old.id === node.id)).length || 0;
  useEvolutionAdvance(`${milestone?.id || ''}:${playbackRound}`, playing && motionVisible, 4000 + (reduced ? 0 : 600 + Math.min(additions, 8) * 120), () => {
    if (autoIndex + 1 >= sequence.length) pause(); else setAutoIndex(value => value + 1);
  });
  const startPlayback = (nextIndex: number) => {
    setAutoIndex(nextIndex); setPlaybackRound(value => value + 1); setPlaying(true);
    const next = new URLSearchParams(params); next.delete('milestone'); setParams(next, { replace: true });
  };
  const togglePlayback = () => { if (playing) pause(); else startPlayback(sequenceIndex < 0 || sequenceIndex === sequence.length - 1 ? 0 : sequenceIndex); };
  const switchMode = (mode: 'story' | 'history') => { pause(); setPlaybackMode(mode); };
  return <main className="evolution-page" data-current-milestone={milestone?.id}>
    <header className="evolution-hero"><ReturnToToday /><div><h1 ref={heading} tabIndex={-1}>从一张日历，到个人信息系统。</h1><p className="evolution-intro">{data ? `${data.milestones.length} 个里程碑 · ${data.snapshots.length} 个架构快照 · ${new Set(data.milestones.flatMap(item => item.featureAreas)).size} 个能力领域` : '回看每一次能力的增加，也看清它们如何连接在一起。'}</p></div>
      <details className="evolution-current"><summary>V{APP_CONFIG.version}</summary><p>历史收录与应用版本独立更新</p>{data && <p>收录截止提交 <code>{data.baseline.slice(0, 7)}</code><br />最早可追溯记录 {data.facts[0] ? day(data.facts[0].date) : '—'}</p>}</details>
    </header>
    {error ? <section className="evolution-state" role="alert"><h2>暂时没有读到成长记录</h2><p>{error}</p><Button onClick={() => setAttempt(value => value + 1)}>重新加载</Button><Link to={`/login?next=${encodeURIComponent('/project?' + params.toString())}`}>重新登录</Link></section> : !data ? <div className="evolution-state" role="status" aria-busy="true">正在读取项目历史…</div> : !milestone || !fact || !snapshot ? <div className="evolution-state" role="status">还没有可展示的里程碑。</div> : <>
      {invalid && <p role="status" className="evolution-notice">链接中的选择无效，已显示最新收录记录。<Button variant="quiet" onClick={() => select(milestone.id)}>重置链接</Button></p>}
      <section id="evolution-architecture" data-playback-active={playing && motionVisible} ref={mapSection} className="evolution-playback-section">
        <EvolutionTimeline data={data} selectedId={milestone.id} important={important} onSelect={select} onPause={pause} />
        <header className="evolution-playback-header"><h2><Layers size={20} />成长演示</h2><div className="evolution-playback-mode" role="group" aria-label="演示范围"><Button size="small" variant={playbackMode === 'story' ? 'primary' : 'quiet'} aria-pressed={playbackMode === 'story'} onClick={() => switchMode('story')}>精选演示 · {important.size} 站</Button><Button size="small" variant={playbackMode === 'history' ? 'primary' : 'quiet'} aria-pressed={playbackMode === 'history'} onClick={() => switchMode('history')}>完整历史 · {data.milestones.length} 个里程碑</Button></div>
          <div className="evolution-playback-actions"><Tooltip content="上一里程碑"><IconButton label="上一里程碑" variant="quiet" disabled={index <= 0} onClick={() => select(data.milestones[index - 1].id)}><ChevronLeft size={18} /></IconButton></Tooltip>
            <Button variant="secondary" leadingIcon={playing ? <Pause size={17} /> : <Play size={17} />} onClick={togglePlayback}>{playing ? '暂停架构播放' : reduced ? '播放历史' : '继续播放'}</Button>
            <Tooltip content="下一里程碑"><IconButton label="下一里程碑" variant="quiet" disabled={index >= data.milestones.length - 1} onClick={() => select(data.milestones[index + 1].id)}><ChevronRight size={18} /></IconButton></Tooltip>
            <Tooltip content="重新播放"><IconButton label="重新播放" variant="quiet" onClick={() => startPlayback(0)}><RotateCcw size={17} /></IconButton></Tooltip></div>
        </header>
        <Architecture data={data} current={snapshot} previous={prior} playing={playing && !reduced} motionActive={motionVisible} onPause={pause} milestone={milestone} comparison={previousMilestone?.title} />
      </section>
      <details id="evolution-growth" className="evolution-evidence" open={evidenceOpen} onToggle={event => setEvidenceOpen(event.currentTarget.open)}><summary>趋势、测试与工程证据</summary>
        <section className="evolution-detail"><h2>工程细节与证据</h2><p>{milestone.engineering}</p><dl><dt>实现提交</dt><dd><code>{fact.commit}</code> <Button size="small" variant="quiet" onClick={async () => { try { await navigator.clipboard.writeText(fact.commit); setCopyStatus('已复制提交哈希'); } catch { setCopyStatus('复制失败，请选择上方哈希手动复制'); } }}>复制</Button><span role="status">{copyStatus}</span></dd><dt>版本依据</dt><dd>该提交的 package.json：{fact.version ?? '未记录'}；标签：{fact.tags.join('、') || '未记录'}。不据此推断发行或部署。</dd><dt>源码依据</dt><dd>{milestone.evidencePaths.join('、')}</dd><dt>验证记录</dt><dd>{milestone.tests ? `本地测试 ${milestone.tests.count} 项；${milestone.tests.evidence}` : '本地测试数量未记录'}；生产验证：本页未记录。</dd><dt>能力领域</dt><dd>{milestone.featureAreas.join(' · ')}</dd></dl>{fact.warnings.map(warning => <p className="evolution-notice" key={warning}>{warning}</p>)}<p className="evolution-muted">历史版本保留当时原值，早期 1.0.0 与后续 0.x 不构成连续递增序列。</p></section>
        {evidenceOpen && <Metrics data={data} selectedId={milestone.id} />}<footer className="evolution-footer">历史基于已收录提交整理 · 日期使用香港时区 · 页面不读取个人日程、邮件或知识内容</footer>
      </details>
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

function Architecture({ data, current, previous, playing, motionActive, onPause, milestone, comparison }: { data: EvolutionData; current: EvolutionSnapshot; previous?: EvolutionSnapshot; playing: boolean; motionActive: boolean; onPause: () => void; milestone: EvolutionMilestone; comparison?: string }) {
  const diff = useMemo(() => architectureChanges(previous, current), [previous, current]);
  const [selectedNode, setSelectedNode] = useState<string>();
  const [full, setFull] = useState(false), [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null), overview = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<{ width: number; height: number; positions: Record<string, OverviewBounds> }>({ width: 1, height: 1, positions: {} });
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
      const positions: Record<string, OverviewBounds> = {};
      element.querySelectorAll<HTMLElement>('[data-group]').forEach(item => { const bounds = item.getBoundingClientRect(); positions[item.dataset.group!] = { x: bounds.left - rect.left + bounds.width / 2, y: bounds.top - rect.top + bounds.height / 2, left: bounds.left - rect.left, right: bounds.right - rect.left, top: bounds.top - rect.top, bottom: bounds.bottom - rect.top }; });
      setGeometry({ width: rect.width, height: rect.height, positions });
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, [full, current.id]);
  useLayoutEffect(() => {
    const element = viewport.current; if (!element || !full) return;
    const fit = () => { if (element.clientWidth && element.clientHeight) setZoom(Math.max(.95, Math.min(1, element.clientWidth / 1110))); };
    fit(); const observer = new ResizeObserver(fit); observer.observe(element); return () => observer.disconnect();
  }, [full, height]);
  return <section className={`evolution-architecture${playing ? ' is-playing' : ''}`} onFocusCapture={event => { if ((event.target as HTMLElement).closest('.evolution-node,.evolution-node-list,.evolution-overview-group')) onPause(); }}>
    <div className="evolution-story-layout"><div className="evolution-diagram-column"><div className="evolution-diagram-toolbar"><h3>{full ? '完整架构' : node ? `聚焦：${node.label}` : '这一刻，系统怎样连接'}</h3><div className="evolution-map-actions"><OrbitSegmentedControl label="架构视图" value={full ? "full" : "simple"} options={[{value:"simple",label:"简明架构"},{value:"full",label:"完整架构"}]} onChange={value => { onPause(); setFull(value === "full"); }} /><Button size="small" disabled={!node} onClick={() => { onPause(); setSelectedNode(undefined); }}>清除节点聚焦</Button></div></div>
      {full ? <div className="evolution-full-map"><div className="evolution-map-controls"><Button aria-label="缩小架构图" disabled={zoom <= .5} onClick={() => setZoom(z => Math.max(.5, z - .1))}>−</Button><span>{Math.round(zoom * 100)}%</span><Button aria-label="放大架构图" disabled={zoom >= 1.5} onClick={() => setZoom(z => Math.min(1.5, z + .1))}>＋</Button><Button onClick={() => { const element = viewport.current; if (element) { setZoom(Math.max(.95, Math.min(1, element.clientWidth / 1110))); element.scrollTo(0, 0); } }}>复位</Button></div>
        <div ref={viewport} className="evolution-map-scroll" tabIndex={0} aria-label="完整架构图，窄屏可横向浏览"><div style={{ width: 1110 * zoom, height: height * zoom }}><div className="evolution-map" style={{ width: 1110, height, transform: `scale(${zoom})` }}>{Object.entries(groups).map(([key, label], i) => <span className="evolution-map-group" style={{ left: [25, 300, 580, 860][i] }} key={key}>{label}</span>)}<svg width="1110" height={height} aria-hidden="true">{diff.edges.map(e => { const a = diff.nodes.find(n => n.id === e.source)!, b = diff.nodes.find(n => n.id === e.target)!; return <path key={`${current.id}:${e.id}`} data-edge={e.id} pathLength="1" style={{ animationDelay: `${Math.min(7, Math.max(0, newNodes.findIndex(n => n.id === e.source), newNodes.findIndex(n => n.id === e.target))) * 120 + 200}ms`, animationPlayState: motionActive ? 'running' : 'paused' }} className={`architecture-edge change-${e.change}${node ? focus.edges.some(item => item.id === e.id) ? ' is-related' : ' is-muted' : ''}`} d={edgePath(a, b)}><title>{a.label} → {b.label}：{changes[e.change]}</title></path>; })}</svg>{diff.nodes.map(n => <Button variant="quiet" key={n.id} data-node={n.id} style={{ left: n.x, top: n.y, animationDelay: `${Math.min(7, Math.max(0, newNodes.findIndex(item => item.id === n.id))) * 120}ms`, animationPlayState: motionActive ? 'running' : 'paused' }} className={`evolution-node change-${n.change}${node && !focus.nodes.has(n.id) ? ' is-muted' : ''}`} aria-pressed={n.id === selectedNode} onClick={() => choose(n.id)}><strong>{n.label}</strong><span>{changes[n.change]}</span></Button>)}</div></div></div><p className="evolution-muted">保留可读字号，随页面纵向阅读；窄屏可横向浏览。缩放不改变历史坐标。</p></div>
      : <div ref={overview} className="evolution-overview" aria-label={node ? `${node.label}及直接连接概览` : '系统分组概览'}><svg className="evolution-overview-edges" viewBox={`0 0 ${geometry.width} ${geometry.height}`} aria-hidden="true">{projection.relations.filter(e => e.source !== e.target).map(e => { const a = geometry.positions[e.source], b = geometry.positions[e.target]; if (!a || !b) return null; const route = overviewRelationPath(a, b); return <g key={e.id} className={node && !e.focused ? 'is-muted' : ''}><path data-relation={e.id} className={`evolution-group-edge change-${relationChange(e.changes)}${e.focused ? ' is-related' : ''}`} d={route.path} /><text x={route.x} y={route.y} textAnchor="middle">{e.count}<title>{groups[e.source]} ↔ {groups[e.target]}：{Object.entries(e.changes).map(([key, count]) => `${changes[key]} ${count}`).join('，')}</title></text></g>; })}</svg>
        {projection.groups.map(group => { const related = group.nodes.filter(n => !node || focus.nodes.has(n.id)), changed = related.filter(n => n.change !== 'unchanged'), featured = (changed.length ? changed : related).slice(0, 2); return <div data-group={group.id} key={group.id} className={`evolution-overview-group${group.related ? '' : ' is-muted'}${playing && changed.some(n => n.change === 'added') ? ' has-additions' : ''}`} style={{ animationPlayState: motionActive ? 'running' : 'paused' }}><h4>{groups[group.id]}<span>{node ? `${related.length} 个相关` : `${group.nodes.length} 个模块`}</span></h4>{featured.length ? featured.map(n => <Button key={n.id} variant="quiet" aria-pressed={n.id === selectedNode} onClick={() => choose(n.id)}><span>{n.label}</span><small className={`change-${n.change}`}>{changes[n.change]}</small></Button>) : <p>此时尚无{node ? '直接关联' : '记录'}</p>}<small>{projection.relations.filter(e => e.source === group.id && e.target === group.id).reduce((sum, e) => sum + e.count, 0)} 条组内连接{related.length > featured.length ? ` · 其余 ${related.length - featured.length}` : ''}</small></div>; })}
      </div>}</div>
      <div className="evolution-story-copy" aria-live={playing ? "off" : "polite"}><p className="evolution-story-meta">{day(data.facts.find(item => item.id === milestone.id)!.date)} · V{data.facts.find(item => item.id === milestone.id)!.version ?? "未记录"} · {data.stages[milestone.stage]}</p><h2>{milestone.title}</h2><p className="evolution-story-summary">{milestone.summary}</p>
        <div className="evolution-legend">{Object.entries(changes).map(([key, label]) => <span className={`change-${key}`} key={key}>{label} {diff.nodes.filter(n => n.change === key).length}</span>)}</div><p className="evolution-comparison">{current.milestone !== milestone.id && <>架构沿用：{origin.title}<br /></>}{previous ? `对比：${comparison}` : '第一个可追溯快照；新增表示此时已有证据。'}</p>
        {node && <article className="evolution-node-detail" aria-live={playing ? 'off' : 'polite'}><div className="evolution-diagram-toolbar"><h3>{node.label}</h3></div><p className={`change-${node.change}`}>{groups[node.group]} · {changes[node.change]}</p><p>{node.description}</p><p><strong>最早可证实：</strong>{firstMilestone?.title ?? '未记录'}</p><div className="evolution-related-list"><strong>直接连接：</strong>{focus.edges.length ? focus.edges.map(e => { const other = diff.nodes.find(n => n.id === (e.source === node.id ? e.target : e.source))!; return <Button variant="quiet" key={e.id} onClick={() => choose(other.id)}>{e.source === node.id ? '→' : '←'} {other.label}{e.label ? ` · ${e.label}` : ''}</Button>; }) : <span>无</span>}</div></article>}
        <details className="evolution-modules"><summary>全部模块与连接说明</summary><nav className="evolution-node-list" aria-label="架构模块">{Object.entries(groups).map(([group, label]) => <div key={group}><h3>{label}</h3>{diff.nodes.filter(n => n.group === group).map(n => <Button variant="quiet" key={n.id} onClick={() => choose(n.id)} aria-pressed={selectedNode === n.id}>{n.label}<span className={`change-${n.change}`}>{changes[n.change]}</span></Button>)}</div>)}</nav><ul className="evolution-connection-list">{projection.relations.map(edge => <li key={edge.id}><strong>{groups[edge.source]}{edge.source === edge.target ? "组内" : ` ↔ ${groups[edge.target]}`} · {edge.count} 条</strong><span>{Object.entries(edge.changes).map(([key, count]) => `${changes[key]} ${count}`).join(" · ")}</span></li>)}</ul></details>
        <p className="evolution-muted">结构与历史证据不代表外部服务已部署或设备已验收。</p>
      </div></div>
  </section>;
}
