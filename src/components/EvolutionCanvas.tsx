import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Maximize, Minus, Plus, Hand } from 'lucide-react';
import { Button, IconButton, Tooltip } from '../ui';

type View = { x: number; y: number; zoom: number };
export function zoomEvolutionView(view: View, zoom: number, point: { x: number; y: number }): View {
  const next = Math.max(.25, Math.min(2.5, zoom)), ratio = next / view.zoom;
  return { x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio, zoom: next };
}

/** A local viewport only. Mouse interactions never install document-level wheel listeners. */
export function EvolutionCanvas({ width, height, children, onInteract }: { width: number; height: number; children: ReactNode; onInteract: () => void }) {
  const viewport = useRef<HTMLDivElement>(null), transform = useRef({ x: 0, y: 0, zoom: 1 }), frame = useRef(0);
  const [view, setView] = useState(transform.current), [touchEditing, setTouchEditing] = useState(false), [dragging, setDragging] = useState(false);
  const callback = useRef(onInteract); callback.current = onInteract;
  const pointers = useRef(new Map<number, { x: number; y: number }>()), moved = useRef(false);
  const description = useId();
  const update = (next: View) => {
    transform.current = next;
    if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; setView(transform.current); });
  };
  const fit = (readable = false) => {
    const element = viewport.current; if (!element?.clientWidth || !element.clientHeight) return;
    const zoom = Math.max(readable ? .9 : .25, Math.min(1, (element.clientWidth - 32) / width, (element.clientHeight - 32) / height));
    update({ zoom, x: Math.max(16, (element.clientWidth - width * zoom) / 2), y: Math.max(16, (element.clientHeight - height * zoom) / 2) });
  };
  const zoomAt = (zoom: number, point?: { x: number; y: number }) => {
    const element = viewport.current; if (!element) return;
    update(zoomEvolutionView(transform.current, zoom, point || { x: element.clientWidth / 2, y: element.clientHeight / 2 }));
  };
  useLayoutEffect(() => {
    const element = viewport.current; if (!element) return;
    const observer = new ResizeObserver(() => fit(true)); observer.observe(element); fit(true);
    return () => observer.disconnect();
  }, [width, height]);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!window.matchMedia('(pointer:fine)').matches) return;
      event.preventDefault(); callback.current();
      const rect = element.getBoundingClientRect(), delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      zoomAt(transform.current.zoom * Math.exp(-Math.max(-180, Math.min(180, delta)) * .002), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  useEffect(() => () => { cancelAnimationFrame(frame.current); pointers.current.clear(); }, []);
  const endPointer = (id: number) => { pointers.current.delete(id); if (!pointers.current.size) setDragging(false); };
  return <div className="evolution-full-map">
    <div className="evolution-map-controls"><span className="evolution-zoom-value">{Math.round(view.zoom * 100)}%</span><Tooltip content="缩小架构图"><IconButton label="缩小架构图" variant="quiet" disabled={view.zoom <= .25} onClick={() => { callback.current(); zoomAt(view.zoom / 1.2); }}><Minus size={16} /></IconButton></Tooltip><Tooltip content="放大架构图"><IconButton label="放大架构图" variant="quiet" disabled={view.zoom >= 2.5} onClick={() => { callback.current(); zoomAt(view.zoom * 1.2); }}><Plus size={16} /></IconButton></Tooltip><Button size="small" variant="secondary" leadingIcon={<Maximize size={16} />} onClick={() => { callback.current(); fit(); }}>适应画布</Button><Button className="evolution-touch-edit" size="small" variant={touchEditing ? 'primary' : 'secondary'} leadingIcon={<Hand size={16} />} aria-pressed={touchEditing} onClick={() => { pointers.current.clear(); setDragging(false); setTouchEditing(value => !value); callback.current(); }}>{touchEditing ? '完成操作' : '操作画布'}</Button></div>
    <div ref={viewport} className={`evolution-map-scroll${touchEditing ? ' is-touch-editing' : ''}${dragging ? ' is-dragging' : ''}`} tabIndex={0} role="region" aria-label="完整架构交互画布" aria-describedby={description} data-zoom={view.zoom} data-pan-x={view.x} data-pan-y={view.y}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (['+', '=', '-', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); callback.current(); }
        if (event.key === '+' || event.key === '=') zoomAt(view.zoom * 1.2);
        else if (event.key === '-') zoomAt(view.zoom / 1.2);
        else if (event.key === 'Home') fit();
        else if (event.key.startsWith('Arrow')) update({ ...transform.current, x: view.x + (event.key === 'ArrowLeft' ? 48 : event.key === 'ArrowRight' ? -48 : 0), y: view.y + (event.key === 'ArrowUp' ? 48 : event.key === 'ArrowDown' ? -48 : 0) });
      }}
      onPointerDown={event => {
        if (!pointers.current.size) moved.current = false;
        if (event.button !== 0 || (event.pointerType !== 'mouse' && !touchEditing) || (!pointers.current.size && (event.target as HTMLElement).closest('button,a,input'))) return;
        callback.current(); moved.current = false; pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const old = pointers.current.get(event.pointerId); if (!old) return;
        const before = [...pointers.current.values()]; pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const after = [...pointers.current.values()];
        if (before.length >= 2) {
          const rect = event.currentTarget.getBoundingClientRect(), middle = (points: typeof before) => ({ x: (points[0].x + points[1].x) / 2 - rect.left, y: (points[0].y + points[1].y) / 2 - rect.top }), a = middle(before), b = middle(after);
          const distance = (points: typeof before) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
          const next = zoomEvolutionView(transform.current, transform.current.zoom * distance(after) / Math.max(1, distance(before)), a);
          update({ ...next, x: next.x + b.x - a.x, y: next.y + b.y - a.y });
        } else update({ ...transform.current, x: transform.current.x + event.clientX - old.x, y: transform.current.y + event.clientY - old.y });
        moved.current = true; setDragging(true);
      }} onPointerUp={event => endPointer(event.pointerId)} onPointerCancel={event => endPointer(event.pointerId)} onLostPointerCapture={event => endPointer(event.pointerId)} onClickCapture={event => { if (moved.current) { event.preventDefault(); event.stopPropagation(); moved.current = false; } }}>
      <div className="evolution-map" style={{ width, height, transform: `translate(${view.x}px,${view.y}px) scale(${view.zoom})` }}>{children}</div>
    </div>
    <p id={description} className="evolution-muted evolution-canvas-hint"><span className="evolution-mouse-hint">空白处拖动平移，滚轮按指针位置缩放；键盘方向键平移，＋/− 缩放，Home 适应画布。</span><span className="evolution-touch-hint">单指可滚动页面；点“操作画布”后单指平移、双指缩放，完成后恢复浏览。</span>初始保持可读字号，适应画布可查看全貌；全部模块也可在说明中浏览。</p>
  </div>;
}
