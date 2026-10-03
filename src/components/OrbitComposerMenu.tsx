import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronRight, MessageSquare, Paperclip, Plus, SlidersHorizontal, X } from 'lucide-react';
import { useDialogLifecycle } from '../hooks/useDialogLifecycle';
import type { useAiSelection } from '../hooks/useAiSelection';

export function OrbitComposerMenu({ ai, onClose, onAttach, onNew, children, busy, attachmentsDisabled }: {
  ai: ReturnType<typeof useAiSelection>; onClose: () => void; onAttach: () => void; onNew: () => void;
  children: ReactNode; busy: boolean; attachmentsDisabled: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useDialogLifecycle(dialog);
  const [view, setView] = useState<'tools' | 'models' | 'history'>('tools');
  const [closing, setClosing] = useState(false);
  const close = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) onClose();
    else setClosing(true);
  };
  useLayoutEffect(() => { dialog.current?.querySelector<HTMLElement>('#orbit-composer-menu-title')?.focus(); }, [view]);
  const selected = ai.models.find(model => model.id === ai.model);
  return createPortal(<dialog ref={dialog} className={`orbit-dialog-viewport orbit-composer-overlay${closing ? ' is-closing' : ''}`} aria-labelledby="orbit-composer-menu-title"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="orbit-composer-menu" onAnimationEnd={event => { if (closing && event.target === event.currentTarget) onClose(); }}>
      <header>{view !== 'tools' && <button type="button" aria-label="返回更多功能" onClick={() => setView('tools')}><ArrowLeft size={18} /></button>}
        <h2 id="orbit-composer-menu-title" tabIndex={-1}>{view === 'tools' ? '更多功能' : view === 'models' ? '模型设置' : '历史对话'}</h2>
        <button type="button" aria-label="关闭更多功能" onClick={close}><X size={18} /></button></header>
      <div className="orbit-composer-menu-body">
        {view === 'tools' ? <div className="orbit-composer-tools">
          <button type="button" onClick={() => setView('models')}><SlidersHorizontal size={20} /><span><strong>模型设置</strong><small>{ai.loading ? '正在读取模型…' : selected?.name || ai.model || '选择或连接模型'}</small></span><ChevronRight size={16} /></button>
          <button type="button" disabled={attachmentsDisabled} onClick={onAttach}><Paperclip size={20} /><span><strong>图片与文件</strong><small>添加附件，最多 3 个</small></span><ChevronRight size={16} /></button>
          <button type="button" onClick={() => setView('history')}><MessageSquare size={20} /><span><strong>历史对话</strong><small>继续对话、管理历史和提醒偏好</small></span><ChevronRight size={16} /></button>
          <button type="button" disabled={busy} onClick={onNew}><Plus size={20} /><span><strong>新建对话</strong><small>当前输入会保留为草稿</small></span><ChevronRight size={16} /></button>
        </div> : view === 'models' ? <div className="orbit-composer-models">
          <p>{ai.provider === 'chatgpt' ? 'ChatGPT' : 'Work Buddy'} · 记住上次选择</p>
          <label htmlFor="orbit-concrete-model">具体模型</label>
          <select id="orbit-concrete-model" value={ai.model} disabled={ai.loading || ai.saving || !ai.models.length} onChange={event => void ai.chooseModel(event.target.value)}>
            {!ai.models.some(model => model.id === ai.model) && <option value={ai.model}>{ai.model ? `${ai.model} · 暂不可用` : '请选择模型'}</option>}
            {ai.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
          </select>
          {(ai.loading || ai.saving) && <p role="status">{ai.loading ? '正在读取模型目录…' : '正在保存偏好…'}</p>}
          {(ai.error || ai.saveError) && <p className="orbit-inline-error" role="alert">{ai.error || ai.saveError}</p>}
          <button type="button" className="secondary-button" disabled={ai.loading || ai.saving} onClick={() => void ai.retry()}>{ai.saveError ? '重试保存偏好' : '重新读取模型'}</button>
          <small>新模型发布时保留当前选择；已下线的模型需要手动重新选择。连接设置位于顶部设置入口。</small>
          {ai.provider === 'chatgpt' && <a href="https://chatgpt.com/#settings" target="_blank" rel="noopener noreferrer">管理 ChatGPT 套餐使用</a>}
        </div> : <div className="orbit-composer-history">{children}</div>}
      </div>
    </section>
  </dialog>, document.body);
}
