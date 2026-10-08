import { composerDraftKey, readComposerDraft, updateComposerDraft, snapshotComposerDraft, consumeComposerDraft, subscribeComposerDraft, type NotificationContext } from '../utils/composer-draft';
import type { NoteImage } from '../utils/note-images';
import { NoteImageGallery, NoteImageInput, useNoteImageUpload } from './NoteImages';
import { OrbitNotificationCard, type NotificationMeta } from './OrbitNotificationCard';
import { forwardRef, useState, useRef, useCallback, useEffect, useImperativeHandle } from 'react';
import { Bot, BookOpen, Send, Loader2, Check, CheckCircle2, Edit3, MapPin, Clock, Save, X, StickyNote, Trash2, Pin, Plus } from 'lucide-react';
import type { InlineConfirmation } from '../hooks/useInlineConfirmation';
import {safeChatHref} from '../utils/chat-markdown';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { AiProviderSelect } from './AiProviderSelect';
import { OrbitSegmentedControl } from './OrbitSegmentedControl';
import { OrbitComposerMenu } from './OrbitComposerMenu';
import { useAiSelection } from '../hooks/useAiSelection';
import {ChatMarkdown} from './ChatMarkdown';
import {OrbitRequestStatus} from './OrbitRequestStatus';
import { useOrbitChat } from '../hooks/useOrbitChat';
import {useChatAttachments,type ChatFile} from '../hooks/useChatAttachments';
import {ChatAttachmentCard,ChatAttachmentComposer} from './ChatAttachments';
import { SCHEDULE_CATEGORY_COLORS, SCHEDULE_CATEGORY_LABELS } from '../utils/scheduleCategories';
import {scheduleItemsForPlan} from '../utils/plan-schedule-items';

// ==================== 类型 ====================

interface Schedule {
  id: string;
  calendar_id: string;
  type: 'event' | 'todo';
  title: string;
  start_time: string;
  end_time?: string;
  all_day: boolean;
  is_unscheduled?: boolean;
  location?: string;
  notes?: string;
  category: string;
  priority: 'high' | 'medium' | 'low';
  is_completed: boolean;
}

interface AiPlanOperation {
  key: string;
  type: 'create' | 'create_recurring' | 'update' | 'delete';
  scheduleId?: string;
  before?: { title?: string; startTime?: string };
  scheduleType?: 'event' | 'todo';
  title: string;
  startTime?: string | null;
  endTime?: string | null;
  allDay?: boolean;
  isUnscheduled?: boolean;
  location?: string | null;
  notes?: string | null;
  recurrence?: {
    frequency: string;
    interval: number;
    unit: string;
    anchorDate?: string | null;
    reminderOffsets?: number[];
    reminderTime?: string;
  } | null;
}

interface AiSchedulePlan {
  id: string;
  expiresAt: string;
  warnings: string[];
  operations: AiPlanOperation[];
  revision?: number;
  state?: string;
}

interface KnowledgeSource {
  referenced?: boolean;
  id: string;
  title: string;
  summary?: string;
  snippet?: string;
  sourceId?: string | null;
  sourceType?: string;
  sourceRef?: string | null;
  type?: string;
  tags?: string[];
  updatedAt?: string;
  target?: { path: string };
}

type MessageRole = 'user' | 'assistant';
type MessageType = 'text' | 'schedules' | 'update' | 'plan' | 'error';

interface ChatMessage {
  attachments?:ChatFile[];
  orbitMeta?:NotificationMeta;
  id: string;
  role: MessageRole;
  type: MessageType;
  text?: string;
  intent?: string;
  scheduleItems?: Schedule[];
  plan?: AiSchedulePlan;
  knowledgeSources?: KnowledgeSource[];
  timestamp: string | null;
  isNew?:boolean;
}

interface AiSchedulePanelProps {
  onSchedulesCreated?: (schedules: Schedule[]) => void;
  onOpenSchedule?: (id: string) => void;
  onOpenScheduleMenu?: (id: string, x: number, y: number) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onSaveNote: (content: string, imageIds?: string[]) => Promise<void>;
  confirmation: InlineConfirmation;
  onChatStateChange?: (state: { hasMessages: boolean; busy: boolean; clearDisabled: boolean }) => void;
}

export interface AiSchedulePanelHandle {
  clearCurrentConversation: () => Promise<void>;
  startConversation:(id:string,title:string)=>Promise<void>;
  refresh: () => Promise<void>;
}

// ==================== 常量 ====================

const CATEGORY_COLORS = SCHEDULE_CATEGORY_COLORS;
const CATEGORY_LABELS = SCHEDULE_CATEGORY_LABELS;

const PRIORITY_COLORS: Record<string, string> = {
  high: '#EF4444', medium: '#F59E0B', low: '#10B981',
};

const AI_RESPONSE_TIMEOUT_MS = 330_000;
const AI_RETRY_WINDOW_MS = 15 * 60 * 1000;

interface PlanOperationForm {
  title: string;
  type: 'event' | 'todo';
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
  isUnscheduled: boolean;
  location: string;
  notes: string;
  anchorDate: string;
  reminderTime: string;
  actionGuide: string;
}

function datePart(value?: string | null): string {
  return value?.slice(0, 10) || '';
}

function timePart(value?: string | null): string {
  return value?.slice(11, 16) || '';
}

function operationToForm(operation: AiPlanOperation): PlanOperationForm {
  return {
    title: operation.title || '',
    type: operation.scheduleType || (operation.isUnscheduled ? 'todo' : 'event'),
    startDate: datePart(operation.startTime),
    startTime: timePart(operation.startTime) || '09:00',
    endDate: datePart(operation.endTime) || datePart(operation.startTime),
    endTime: timePart(operation.endTime),
    allDay: operation.allDay === true,
    isUnscheduled: operation.isUnscheduled === true,
    location: operation.location || '',
    notes: operation.notes || '',
    anchorDate: operation.recurrence?.anchorDate || datePart(operation.startTime),
    reminderTime: operation.recurrence?.reminderTime || '12:00',
    actionGuide: operation.notes || '',
  };
}

function PlanOperationCard({ operation, editing, saving, onStartEdit, onCancel, onSave, onRemove, disabled=false }: {
  operation: AiPlanOperation;
  editing: boolean;
  saving: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onRemove: () => Promise<void>;
  disabled?:boolean;
}) {
  const [form, setForm] = useState<PlanOperationForm>(() => operationToForm(operation));

  useEffect(() => {
    setForm(operationToForm(operation));
  }, [operation]);

  const update = <K extends keyof PlanOperationForm>(key: K, value: PlanOperationForm[K]) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const save = async () => {
    if (!form.title.trim()) return window.alert('标题不能为空');
    try {
      if (operation.type === 'create_recurring') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(form.anchorDate)) return window.alert('请填写有效的起始日期');
        if (!/^\d{2}:\d{2}$/.test(form.reminderTime)) return window.alert('请填写有效的提醒时间');
        await onSave({ title: form.title.trim(), anchorDate: form.anchorDate, reminderTime: form.reminderTime, actionGuide: form.actionGuide });
        return;
      }
      if (!form.isUnscheduled && !/^\d{4}-\d{2}-\d{2}$/.test(form.startDate)) return window.alert('请填写有效的开始日期');
      const startTime = form.isUnscheduled ? undefined : `${form.startDate}T${form.allDay ? '00:00' : (form.startTime || '09:00')}:00`;
      const endTime = form.isUnscheduled || form.allDay || !form.endDate || !form.endTime
        ? ''
        : `${form.endDate}T${form.endTime}:00`;
      await onSave({
        type: form.isUnscheduled ? 'todo' : form.type,
        title: form.title.trim(),
        ...(startTime ? { startTime } : {}),
        endTime,
        allDay: form.isUnscheduled ? false : form.allDay,
        isUnscheduled: form.isUnscheduled,
        location: form.location,
        notes: form.notes,
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : '保存计划项失败');
    }
  };

  const actionLabel: Record<string, string> = { create: '新建日程', create_recurring: '周期事项', update: '修改日程', delete: '删除日程' };
  const recurrenceUnit = operation.recurrence?.frequency === 'monthly' ? '月'
    : operation.recurrence?.frequency === 'yearly' ? '年'
      : operation.recurrence?.unit === 'month' ? '月'
        : operation.recurrence?.unit === 'year' ? '年' : '天';
  const timeLabel = operation.isUnscheduled
    ? '无具体日期 · 挂起待办'
    : operation.recurrence
      ? `每 ${operation.recurrence.interval || 1} ${recurrenceUnit} · 起始 ${operation.recurrence.anchorDate || '待确认'}`
      : operation.startTime ? `${formatDate(operation.startTime)} ${operation.allDay ? '全天' : formatTime(operation.startTime)}` : '时间待确认';

  return <div
    className="rounded-md px-2 py-1.5"
    style={{ backgroundColor: 'var(--td-bg-color-container)', border: '1px solid var(--td-component-stroke)' }}
  >
    {!editing ? <>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium" style={{ color: 'var(--td-text-color-primary)' }}>{operation.title}</div>
        {!disabled && <div className="ai-plan-item-actions">
          {operation.type !== 'delete' && <button type="button" className="ai-plan-edit-button" disabled={saving} onClick={event => { event.stopPropagation(); onStartEdit(); }} aria-label={`编辑计划项 ${operation.title}`}><Edit3 size={13} /> 编辑</button>}
          {['create','create_recurring'].includes(operation.type) && <button type="button" className="ai-plan-edit-button ai-plan-remove-button" disabled={saving} onClick={event => { event.stopPropagation(); void onRemove(); }} aria-label={`删除待创建条目 ${operation.title}`}><Trash2 size={13} /> 删除</button>}
        </div>}
      </div>
      <div className="text-[11px] mt-0.5" style={{ color: 'var(--td-text-color-secondary)' }}>{actionLabel[operation.type] || '处理'} · {timeLabel}</div>
      {operation.before && <div className="text-[11px] mt-1" style={{color:'var(--td-text-color-secondary)'}}>原事项：{operation.before.title} · {operation.before.startTime?.replace('T',' ')} → {operation.startTime?.replace('T',' ') || '保留原时间'}{operation.scheduleId?.startsWith('reminder-cycle:') ? '（仅本周期安排日期）' : ''}</div>}
      {operation.location && <div className="text-[11px] mt-0.5" style={{ color: 'var(--td-text-color-secondary)' }}>地点：{operation.location}</div>}
      {operation.notes && <div className="text-[11px] mt-0.5 whitespace-pre-line" style={{ color: 'var(--td-text-color-secondary)' }}>备注：{operation.notes}</div>}
      {operation.type === 'delete' && <div className="text-[11px] mt-1" style={{ color: '#B45309' }}>删除计划不能编辑；如需调整，请取消后重新描述。</div>}
    </> : <div className="ai-plan-operation-editor">
      <div className="ai-plan-editor-head"><strong>编辑计划项</strong><button type="button" className="icon-button" onClick={onCancel} disabled={saving} aria-label="取消编辑"><X size={14} /></button></div>
      {operation.type === 'create_recurring' ? <>
        <label>标题<input value={form.title} onChange={event => update('title', event.target.value)} autoFocus /></label>
        <div className="ai-plan-editor-grid"><label>起始日期<input type="date" value={form.anchorDate} onChange={event => update('anchorDate', event.target.value)} /></label><label>提醒时间<input type="time" value={form.reminderTime} onChange={event => update('reminderTime', event.target.value)} /></label></div>
        <label>操作说明<textarea rows={2} value={form.actionGuide} onChange={event => update('actionGuide', event.target.value)} /></label>
      </> : <>
        <label>标题<input value={form.title} onChange={event => update('title', event.target.value)} autoFocus /></label>
        <label>类型<select value={form.type} onChange={event => update('type', event.target.value as PlanOperationForm['type'])} disabled={form.isUnscheduled}><option value="event">日程</option><option value="todo">待办</option></select></label>
        <div className="ai-plan-editor-grid"><label>开始日期<input type="date" value={form.startDate} onChange={event => update('startDate', event.target.value)} disabled={form.isUnscheduled} /></label><label>开始时间<input type="time" value={form.startTime} onChange={event => update('startTime', event.target.value)} disabled={form.isUnscheduled || form.allDay} /></label></div>
        <div className="ai-plan-editor-grid"><label>结束日期<input type="date" value={form.endDate} onChange={event => update('endDate', event.target.value)} disabled={form.isUnscheduled || form.allDay} /></label><label>结束时间<input type="time" value={form.endTime} onChange={event => update('endTime', event.target.value)} disabled={form.isUnscheduled || form.allDay} /></label></div>
        <div className="ai-plan-editor-checks"><label><input type="checkbox" checked={form.allDay} onChange={event => update('allDay', event.target.checked)} disabled={form.isUnscheduled} /> 全天</label><label><input type="checkbox" checked={form.isUnscheduled} onChange={event => update('isUnscheduled', event.target.checked)} /> 无固定期限待办</label></div>
        <label>地点<input value={form.location} onChange={event => update('location', event.target.value)} /></label>
        <label>备注<textarea rows={2} value={form.notes} onChange={event => update('notes', event.target.value)} /></label>
      </>}
      <div className="ai-plan-editor-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>取消</button><button type="button" className="primary-button" onClick={save} disabled={saving}><Save size={13} />{saving ? '保存中…' : '保存这项'}</button></div>
    </div>}
  </div>;
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() || `ai_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function readJsonResponse(response: Response): Promise<any> {
  const raw = await response.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const contentType = response.headers.get('content-type') || '未知类型';
    const preview = raw.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(`服务返回了非 JSON 内容（${contentType}）：${preview || '空响应'}。请检查代理超时或服务状态。`);
  }
}

// 【关键修复】获取本地时区的日期字符串（YYYY-MM-DD）
function getLocalDateString(date?: Date): string {
  const d = date || new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch { return isoStr; }
}

function parseMessageTimestamp(value: string | null): Date | null {
  if (!value || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMessageTimestamp(value: string | null): string {
  const date = parseMessageTimestamp(value);
  if (!date) return '时间未知';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    if (d.toDateString() === today.toDateString()) return '今天';
    if (d.toDateString() === tomorrow.toDateString()) return '明天';
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  } catch { return isoStr.split('T')[0]; }
}

// ==================== 日程卡片 ====================

function ScheduleMiniCard({ schedule, onOpen, onOpenMenu }: {
  schedule: Schedule;
  onOpen?: (id: string) => void;
  onOpenMenu?: (id: string, x: number, y: number) => void;
}) {
  const color = CATEGORY_COLORS[schedule.category] || '#6B7280';
  const pColor = PRIORITY_COLORS[schedule.priority] || '#F59E0B';
  const dateStr = schedule.is_unscheduled ? '无固定日期' : formatDate(schedule.start_time);
  const startStr = schedule.is_unscheduled ? '' : schedule.all_day ? '全天' : formatTime(schedule.start_time);
  const endStr = schedule.end_time && !schedule.all_day ? ` - ${formatTime(schedule.end_time)}` : '';

  return (
    <button
      type="button"
      className="ai-schedule-card w-full rounded-xl p-3 mb-2 text-left transition-all"
      style={{
        background: 'var(--td-bg-color-container)',
        border: `1px solid ${pColor}30`,
        borderLeft: `3px solid ${pColor}`,
      }}
      onClick={() => onOpen?.(schedule.id)}
      onContextMenu={event => {
        event.preventDefault();
        onOpenMenu?.(schedule.id, event.clientX, event.clientY);
      }}
      onKeyDown={event => {
        if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onOpenMenu?.(schedule.id, rect.left + 24, rect.top + 24);
        }
      }}
      aria-label={`打开日程详情：${schedule.title}`}
    >
      <div className="flex items-center gap-1.5 mb-1.5 min-w-0">
        <span
          className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
          style={{ backgroundColor: `${color}18`, color }}
        >
          {schedule.type === 'todo' ? '待办' : CATEGORY_LABELS[schedule.category] || '其他'}
        </span>
        <span className="schedule-title-primary truncate">
          {schedule.is_completed ? '已完成 · ' : ''}{schedule.title}
        </span>
      </div>

      <div className="flex items-center gap-3 min-w-0" style={{ color: 'var(--td-text-color-secondary)' }}>
        <span className="flex items-center gap-1 text-xs flex-shrink-0">
          <Clock className="w-3 h-3" />
          {dateStr} {startStr}{endStr}
        </span>
        {schedule.location && (
          <span className="flex items-center gap-1 text-xs truncate">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            {schedule.location}
          </span>
        )}
      </div>

      {schedule.notes && (
        <div className="mt-1.5 text-xs truncate" style={{ color: 'var(--td-text-color-secondary)' }}>
          备注：{schedule.notes}
        </div>
      )}
    </button>
  );
}

// ==================== 消息气泡 ====================

function MessageBubble({ msg, onNotificationRefresh, onReminderAction, onOpenSchedule, onOpenScheduleMenu, onConfirmPlan, onDiscardPlan, onUpdatePlanOperation, confirmingPlanId, savingPlanOperationKey }: {
  msg: ChatMessage;
  onReminderAction?:(id:string,action:string)=>Promise<void>;
  onNotificationRefresh?:()=>void;
  onOpenSchedule?: (id: string) => void;
  onOpenScheduleMenu?: (id: string, x: number, y: number) => void;
  onConfirmPlan?: (messageId: string, planId: string) => void;
  onDiscardPlan?: (messageId: string) => void;
  onUpdatePlanOperation?: (planId: string, key: string, patch: Record<string, unknown>, action?: 'remove') => Promise<void>;
  confirmingPlanId?: string | null;
  savingPlanOperationKey?: string | null;
}) {
  const isUser = msg.role === 'user';
  const {authHeaders}=useAuth();
  const [editingOperationKey, setEditingOperationKey] = useState<string | null>(null);
  const [reminderBusy,setReminderBusy]=useState(false),[reminderError,setReminderError]=useState('');
  const timestamp = parseMessageTimestamp(msg.timestamp);
  const scheduleItems = msg.type === 'plan' ? scheduleItemsForPlan(msg.scheduleItems || [], msg.plan?.operations || []) : msg.scheduleItems;
  const messageTime = <time className={`ai-message-timestamp${isUser ? ' is-user' : ''}${msg.type === 'error' ? ' is-error' : ''}`} dateTime={timestamp ? msg.timestamp || undefined : undefined}>{formatMessageTimestamp(msg.timestamp)}</time>;

  if (isUser) {
    return (
      <div id={"orbit-message-"+msg.id} className="flex justify-end mb-3">
        <div
          className="orbit-user-message px-3 py-2 rounded-2xl rounded-tr-sm max-w-[88%] leading-relaxed whitespace-pre-line"
          style={{ backgroundColor: 'var(--td-brand-color)', color: '#fff' }}
        >
          {msg.text}
          {msg.attachments?.map(file=><ChatAttachmentCard key={file.id} file={file} authHeaders={authHeaders}/>)}
          {messageTime}
        </div>
      </div>
    );
  }

  // AI 回复
  const intentLabel: Record<string, string> = {
    create: '创建', update: '修改', delete: '删除', query: '查询', chat: '对话', weather: '天气'
  };

  return (
    <div id={'orbit-message-'+msg.id} className={'flex justify-start mb-3 orbit-message'+(msg.orbitMeta?.origin==='notification'?' is-notification':'')} data-new={msg.isNew||undefined}>
      <div className="max-w-[96%] w-full">
        {/* AI 头像行 */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-xs"
            style={{ backgroundColor: 'var(--td-brand-color)' }}
          >
            <Bot className="w-3 h-3 text-white" />
          </div>
          <span className="text-xs font-medium" style={{ color: 'var(--td-text-color-secondary)' }}>
            {msg.orbitMeta?.origin==='notification'?'Orbit 通知':'AI 助手'}
            {msg.intent && msg.intent !== 'chat' && (
              <span className="ml-1">· {intentLabel[msg.intent] || ''}</span>
            )}
          </span>
        </div>

        {msg.type === 'error' ? (
          <div className="orbit-message-error px-3 py-2 rounded-lg" role="alert" style={{ backgroundColor: 'var(--td-error-color-light)', color: 'var(--td-error-color)', border: '1px solid var(--td-error-color)' }}>
            {msg.text}
            {messageTime}
          </div>
        ) : (
          <div
            className="rounded-2xl rounded-tl-sm px-3 py-2.5"
            style={{ backgroundColor: 'var(--td-bg-color-page)', border: '1px solid var(--td-component-stroke)' }}
          >
            {/* 文字回复 */}
            {msg.text && (
              <div className="flex items-start gap-1.5 mb-2">
                {msg.plan?.state === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: 'var(--td-success-color)' }} />}
                <ChatMarkdown text={msg.text}/>
              </div>
            )}

            {msg.knowledgeSources && msg.knowledgeSources.length > 0 && (
              <div className="ai-knowledge-sources" aria-label="参考知识库">
                <div className="ai-knowledge-sources-title"><BookOpen size={13} aria-hidden="true" />参考知识库 · {msg.knowledgeSources.length} 条</div>
                <div className="ai-knowledge-source-list">
                  {msg.knowledgeSources.filter(source=>source.referenced !== false).map((source,index) => (
                    <Link key={source.id} className="ai-knowledge-source" to={source.target?.path || `/library/${encodeURIComponent(source.id)}`}>
                      <span className="ai-knowledge-source-head"><strong>{source.referenced ? `${index+1}. ` : ''}{source.title}</strong><span>查看</span></span>
                      {(source.summary || source.snippet) && <span className="ai-knowledge-source-snippet">{source.summary || source.snippet}</span>}
                      <small>{({knowledge:'知识',experience:'经验',idea:'想法'} as Record<string,string>)[source.type || ''] || '知识库内容'}</small>
                    </Link>
                  ))}
                </div>
                {msg.knowledgeSources.some(source=>source.referenced===false) && <details><summary>其他检索结果 · {msg.knowledgeSources.filter(source=>source.referenced===false).length} 条</summary>{msg.knowledgeSources.filter(source=>source.referenced===false).map(source=><Link key={source.id} className="ai-knowledge-source" to={source.target?.path || `/library/${encodeURIComponent(source.id)}`}><strong>{source.title}</strong><span className="ai-knowledge-source-snippet">{source.summary || source.snippet}</span></Link>)}</details>}
              </div>
            )}

            {msg.type === 'plan' && msg.plan && (
              <div className="mt-2 rounded-lg p-2.5 orbit-plan" style={{ backgroundColor: 'var(--td-brand-color-light)', border: '1px solid var(--td-component-stroke)' }}>
                <div className="text-xs font-medium mb-2" style={{ color: 'var(--td-brand-color)' }}>{({pending:'待确认',suspended:'已挂起',expired:'已过期',cancelled:'已取消',completed:'已完成',partially_completed:'部分完成',failed:'执行失败'} as Record<string,string>)[msg.plan.state||'pending']}执行计划 · {msg.plan.operations.length} 项 · 版本 {msg.plan.revision||1}</div>
                {msg.plan.warnings.map((warning, index) => (
                  <div key={`${warning}-${index}`} className="text-xs mb-1" style={{ color: '#B45309' }}>需核对：{warning}</div>
                ))}
                <div className="space-y-1.5">
                  {msg.plan.operations.map(operation => <PlanOperationCard
                    key={operation.key}
                    operation={operation}
                    disabled={!!msg.plan?.state&&msg.plan.state!=='pending'}
                    editing={editingOperationKey === operation.key}
                    saving={!!savingPlanOperationKey || !!confirmingPlanId}
                    onStartEdit={() => {if(!msg.plan?.state||msg.plan.state==='pending')setEditingOperationKey(operation.key);}}
                    onCancel={() => setEditingOperationKey(null)}
                    onSave={async patch => {
                      await onUpdatePlanOperation?.(msg.plan!.id, operation.key, patch);
                      setEditingOperationKey(null);
                    }}
                    onRemove={async () => {
                      setReminderError('');
                      try {
                        await onUpdatePlanOperation?.(msg.plan!.id, operation.key, {}, 'remove');
                        setEditingOperationKey(null);
                      } catch (error) { setReminderError(error instanceof Error ? error.message : '删除待创建条目失败'); }
                    }}
                  />)}
                </div>
                {(!msg.plan.state || msg.plan.state==='pending') && <div className="flex justify-end gap-2 mt-2.5">
                  <button type="button" className="secondary-button" onClick={() => onDiscardPlan?.(msg.id)} disabled={!!confirmingPlanId || !!savingPlanOperationKey}>取消</button>
                  <button type="button" className="primary-button" onClick={() => onConfirmPlan?.(msg.id, msg.plan!.id)} disabled={!!confirmingPlanId || !!savingPlanOperationKey}>
                    {confirmingPlanId === msg.plan.id ? '正在执行…' : '确认并执行'}
                  </button>
                </div>}
                {msg.plan.state==='suspended' && <button type="button" className="secondary-button" onClick={()=>void onUpdatePlanOperation?.(msg.plan!.id,'resume',{})}>恢复这份草稿</button>}
              </div>
            )}

            {/* 使用结构化数据渲染可点击日程卡片 */}
            {scheduleItems && scheduleItems.length > 0 && (
              <div className="mt-2">
                {scheduleItems.map(schedule => (
                  <ScheduleMiniCard
                    key={schedule.id}
                    schedule={schedule}
                    onOpen={onOpenSchedule}
                    onOpenMenu={onOpenScheduleMenu}
                  />
                ))}
              </div>
            )}
            {msg.orbitMeta?.origin==='notification'&&<OrbitNotificationCard meta={msg.orbitMeta} title={(msg.text||'Orbit 通知').split('\n')[0]} onRefresh={onNotificationRefresh}/>}
            {msg.orbitMeta?.settingRefs?.map(item=><Link className="orbit-setting-card" key={item.id} to={'/assistant?settings='+encodeURIComponent(item.id)}>{item.label} →</Link>)}
            {msg.orbitMeta?.origin==='proactive' && <div className={`orbit-reminder-actions ${msg.orbitMeta.state==='handled'?'is-handled':''}`}><small>{msg.orbitMeta.enhanced?'Orbit 主动提醒':'Orbit 主动提醒 · 基于事项信息'}</small>{msg.orbitMeta.state==='sent' && <div>{[['complete','完成'],['snooze','15 分钟后'],['tomorrow','明天 09:00 再提醒']].map(([action,label])=><button type="button" key={action} disabled={reminderBusy} onClick={()=>{setReminderBusy(true);setReminderError('');void onReminderAction?.(msg.orbitMeta!.eventId!,action).catch(e=>setReminderError(e.message)).finally(()=>setReminderBusy(false));}}>{label}</button>)}</div>}{msg.orbitMeta.state==='handled'&&<span>{msg.orbitMeta.handledAction==='complete'?'✓ 已完成':msg.orbitMeta.nextReminderAt?`已延后 · ${new Date(msg.orbitMeta.nextReminderAt).toLocaleString()}`:'已处理'}{msg.orbitMeta.handledAt&&<small> · {new Date(msg.orbitMeta.handledAt).toLocaleString()}</small>}</span>}{msg.orbitMeta.state==='discarded'&&<span>提醒已失效，请查看当前事项</span>}{reminderError&&<p role="alert">{reminderError}</p>}</div>}
            {!!(msg.orbitMeta as any)?.sources?.length&&<details className="orbit-message-sources"><summary>联网来源 · {(msg.orbitMeta as any).sources.length}</summary>{(msg.orbitMeta as any).sources.map((source:any)=><a key={source.url} href={safeChatHref(source.url)} target="_blank" rel="noopener noreferrer"><strong>{source.title}</strong><small>{source.source} · {source.publishedAt?new Date(source.publishedAt).toLocaleString():'发布时间未知'} · 获取 {new Date(source.retrievedAt).toLocaleString()}</small></a>)}</details>}
            {!!(msg.orbitMeta as any)?.steps?.length&&<details className="orbit-message-steps"><summary>处理步骤</summary>{(msg.orbitMeta as any).steps.map((s:any)=><p key={s.id}>{s.state==='completed'?'✓':s.state==='failed'?'!':'…'} {s.label} · {s.query}</p>)}</details>}
            {msg.plan?.state&&['completed','partially_completed','failed'].includes(msg.plan.state)&&<div className="orbit-outcome"><p role="status">{msg.plan.state==='completed'?'✓ 已完成':msg.plan.state==='partially_completed'?'部分事项已完成，请核对未执行项目':'执行失败，正式结果请核对失败原因'}</p>{msg.plan.state!=='completed'&&<button type="button" className="secondary-button" disabled={!!savingPlanOperationKey} onClick={()=>void onUpdatePlanOperation?.(msg.plan!.id,'retry',{}).catch(e=>setReminderError(e.message))}>为失败项创建新草稿</button>}</div>}
            {msg.plan&&reminderError&&<p role="alert">{reminderError}</p>}
            {messageTime}
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== 主组件 ====================

export const AiSchedulePanel = forwardRef<AiSchedulePanelHandle, AiSchedulePanelProps>(function AiSchedulePanel({
  onSchedulesCreated,
  onOpenSchedule,
  onOpenScheduleMenu,
  collapsed = false,
  onSaveNote,
  onChatStateChange,
  confirmation,
}, ref) {
  const [inputText, setInputText] = useState('');
  const [noteImages, setNoteImages] = useState<NoteImage[]>([]);
  const noteImageInputRef = useRef<HTMLInputElement>(null);


  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [confirmingPlanId, setConfirmingPlanId] = useState<string | null>(null);
  const [savingPlanOperationKey, setSavingPlanOperationKey] = useState<string | null>(null);
  const planMutationRef = useRef(false);
  const [noteMode, setNoteMode] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  const { isAuthenticated, authHeaders, user } = useAuth();
  const ai = useAiSelection(authHeaders, isAuthenticated);
  const aiConnection = { provider: ai.provider, model: ai.model };
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const savingNotesRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const followBottom=useRef(true),seenMessages=useRef(new Set<string>());
  const [hasNewReply,setHasNewReply]=useState(false);
  const orbit = useOrbitChat(authHeaders,isAuthenticated);
  const activeConversation = useRef(orbit.cid); activeConversation.current = orbit.cid;
  const attachments=useChatAttachments(orbit.cid,authHeaders);
  const isLoading = orbit.requests.some(r => r.state === 'running' || r.state === 'queued');
  const [composerMenuOpen, setComposerMenuOpen] = useState(false);
  const setConversationDrawer = setComposerMenuOpen;
  const [renameTitle, setRenameTitle] = useState<string | null>(null);
  const [targetConversation, setTargetConversation] = useState('');
  const location=useLocation();
  const [notificationContext, setNotificationContext] = useState<NotificationContext>();
  const draftKey = composerDraftKey(user?.id || '', orbit.cid);
  const activeDraftKey = useRef(draftKey); activeDraftKey.current = draftKey;
  const changeText = useCallback((text: string) => { updateComposerDraft(draftKey, { text }); }, [draftKey]);
  const changeImages = useCallback((images: NoteImage[]) => { updateComposerDraft(draftKey, { images }); }, [draftKey]);
  const imageUpload = useNoteImageUpload(noteImages, changeImages);
  const draftReady = !!user?.id && !!orbit.cid;
  const mutationBusy = !!confirmation.busy || orbit.mutating;
  const destructiveBlocked = orbit.creating || orbit.submitting || savingNotes || imageUpload.busy || !!confirmingPlanId || !!savingPlanOperationKey || attachments.files.some(file => ['uploading', 'processing'].includes(file.state));
  const clearDisabled = !draftReady || destructiveBlocked || isLoading || mutationBusy;
  const cannotSend = !draftReady || orbit.creating || orbit.submitting || savingNotes || mutationBusy || (noteMode ? imageUpload.busy || (!inputText.trim() && !noteImages.length) : (!inputText.trim() && !attachments.files.length) || !attachments.ready || !ai.ready);
  useEffect(() => {
    const sync = (key: string) => { if (key === draftKey) { const draft = readComposerDraft(key); setInputText(draft.text); setNoteImages(draft.images); setNotificationContext(draft.notificationContext); } };
    sync(draftKey); return subscribeComposerDraft(sync);
  }, [draftKey]);
  useEffect(() => {
    const continueChat = (event: Event) => {
      const detail = (event as CustomEvent<NotificationContext>).detail;
      if (typeof detail?.notificationId !== 'string' || !detail.notificationId || detail.notificationId.length > 200 || typeof detail.title !== 'string') return;
      updateComposerDraft(draftKey, { notificationContext: { notificationId: detail.notificationId, title: detail.title.slice(0, 200) } });
      setNoteMode(false); textareaRef.current?.focus();
    };
    window.addEventListener('orbit:continue-notification', continueChat);
    return () => window.removeEventListener('orbit:continue-notification', continueChat);
  }, [draftKey]);
  useEffect(()=>{setRenameTitle(null);followBottom.current=true;seenMessages.current.clear();setHasNewReply(false);},[orbit.cid,user?.id]);

  useEffect(() => {
    onChatStateChange?.({ hasMessages: messages.length > 0, busy: isLoading, clearDisabled });
  }, [isLoading, messages.length, clearDisabled, onChatStateChange]);

  const clearConversation = useCallback(async (id: string) => {
    if (destructiveBlocked || (id === orbit.cid && isLoading)) throw new Error('请等待当前操作结束后再清空对话');
    await orbit.clear(id);
    if (id === activeConversation.current) { attachments.clear(); updateComposerDraft(activeDraftKey.current, { notificationContext: undefined }); setHasNewReply(false); }
  }, [destructiveBlocked, isLoading, orbit.cid, orbit.clear, attachments.clear]);
  const closeComposerMenu = () => { confirmation.reset(); setComposerMenuOpen(false); };

  useEffect(() => {
    setMessages(orbit.history.map(m => ({
      id: m.id, role: m.role, type: m.type || 'text', text: m.text || m.content || '',
      intent: m.intent, scheduleItems: m.scheduleItems, plan: m.plan, knowledgeSources: m.knowledgeSources,orbitMeta:m.orbitMeta,attachments:m.attachments,
      timestamp: m.timestamp || m.created_at || null,
      isNew:seenMessages.current.size>0&&!seenMessages.current.has(m.id),
    })));
    if(seenMessages.current.size>0&&!followBottom.current&&orbit.history.some(m=>m.role==='assistant'&&!seenMessages.current.has(m.id)))setHasNewReply(true);
    seenMessages.current=new Set(orbit.history.map(m=>m.id));
  }, [orbit.history]);

  // 自动滚到底部
  useEffect(() => {
    const container = messagesContainerRef.current;
    if(followBottom.current)container?.scrollTo({ top: container.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, 144);
    textarea.style.height = `${Math.max(nextHeight, 40)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 144 ? 'auto' : 'hidden';
  }, [inputText, collapsed]);

  const handleUpdatePlanOperation = useCallback(async (planId: string, key: string, patch: Record<string, unknown>, action?: 'remove') => {
    if (planMutationRef.current) throw new Error('计划正在处理中，请稍候');
    planMutationRef.current = true;
    const savingKey = `${planId}:${key}`;
    setSavingPlanOperationKey(savingKey);
    try {
      const expectedRevision=messages.find(m=>m.plan?.id===planId)?.plan?.revision||1;
      const lifecycle=['resume','retry'].includes(key);
      const response = await fetch(lifecycle?`/api/ai-chat/plans/${encodeURIComponent(planId)}/${key}`:`/api/ai-chat/plans/${encodeURIComponent(planId)}/operations/${encodeURIComponent(key)}`, {
        method: lifecycle?'POST':action === 'remove' ? 'DELETE' : 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({...patch,expectedRevision}),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.plan) throw new Error(data.error || '保存计划项失败');
      if(key==='retry'){await orbit.refresh();return;}
      setMessages(previous => previous.map(message => message.plan?.id === planId ? {
        ...message,
        plan: data.plan,
        ...(action === 'remove' ? {text: data.plan.reply} : {}),
      } : message));
    } finally {
      planMutationRef.current = false;
      setSavingPlanOperationKey(null);
    }
  }, [authHeaders,messages,orbit.refresh]);

  const submitMessage = useCallback(async (rawText: string, options: { clearComposer?: boolean } = {}) => {
    const text = rawText.trim()||(attachments.files.length?'请阅读附件并说明主要内容':'');if(!text||!attachments.ready||!ai.ready) return;
    const submitted = snapshotComposerDraft(draftKey);
    try {
      const accepted = await orbit.send(text,{calendarId:'personal',...aiConnection,notificationId:submitted.notificationContext?.notificationId,attachmentIds:attachments.files.map(f=>f.id)});
      if(accepted && activeDraftKey.current === submitted.key) attachments.clear();
      if(accepted && options.clearComposer !== false) consumeComposerDraft(submitted, false);
    } catch(error) {orbit.setError(error instanceof Error?error.message:'发送失败，请重试');}
  }, [orbit.send,orbit.setError,ai.provider,ai.model,ai.ready,attachments,draftKey]);

  const handleSubmit = useCallback(() => {
    void submitMessage(inputText, { clearComposer: true });
  }, [inputText, submitMessage]);

  const handleSaveNotes = useCallback(async () => {
    if (savingNotesRef.current || orbit.creating || mutationBusy || imageUpload.busy || (!inputText.trim() && !noteImages.length)) return;
    savingNotesRef.current = true;
    const submitted = snapshotComposerDraft(draftKey);
    setSavingNotes(true);
    orbit.setError('');
    try {
      await onSaveNote(submitted.text, submitted.images.map(image => image.id));
      consumeComposerDraft(submitted, true);
    } catch (error) {
      orbit.setError(error instanceof Error ? error.message : '保存记事失败，输入已保留。');
    } finally {
      savingNotesRef.current = false; setSavingNotes(false);
      textareaRef.current?.focus();
    }
  }, [inputText, noteImages, imageUpload.busy, onSaveNote, orbit.creating, mutationBusy, draftKey, orbit.setError]);


  const handleConfirmPlan = useCallback(async (messageId: string, planId: string) => {
    if (planMutationRef.current) return;
    planMutationRef.current = true;
    setConfirmingPlanId(planId);
    try {
      const response = await fetch('/api/ai-chat/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ planId,expectedRevision:messages.find(m=>m.plan?.id===planId)?.plan?.revision||1 }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data.error || '确认计划失败');
      setMessages(previous => previous.map(message => message.id === messageId ? {
        ...message,
        type: 'schedules',
        text: data.reply,
        plan: undefined,
        scheduleItems: data.scheduleItems || [],
      } : message));
      await orbit.refresh();
      if (data.changed) onSchedulesCreated?.(data.changedDetails?.created || []);
    } catch (error: any) {
      setMessages(previous => [...previous, {
        id: (Date.now() + 2).toString(),
        role: 'assistant',
        type: 'error',
        text: error?.message || '确认计划失败，请重试。',
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      planMutationRef.current = false;
      setConfirmingPlanId(null);
    }
  }, [authHeaders, confirmingPlanId, onSchedulesCreated,messages,orbit.refresh]);

  const handleDiscardPlan = useCallback(async (messageId: string) => {
    if (planMutationRef.current) return;
    const discarded = messages.find(message => message.id === messageId);
    if (discarded?.plan) {
      planMutationRef.current = true;
      setSavingPlanOperationKey(`${discarded.plan.id}:cancel`);
      try { const response=await fetch(`/api/ai-chat/plans/${encodeURIComponent(discarded.plan.id)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ expectedRevision: discarded.plan.revision||1 }),
      });const data=await readJsonResponse(response);if(!response.ok)throw new Error(data.error||'取消失败');await orbit.refresh();}
      catch(error){orbit.setError(error instanceof Error?error.message:'取消失败');}
      finally { planMutationRef.current = false; setSavingPlanOperationKey(null); }
    }
  }, [authHeaders, messages,orbit.refresh,orbit.setError]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (cannotSend && !e.nativeEvent.isComposing && e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); return; }
    if (noteMode) {
      if (!e.nativeEvent.isComposing && e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        void handleSaveNotes();
      }
      return;
    }
    if (!e.nativeEvent.isComposing && e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useImperativeHandle(ref, () => ({ clearCurrentConversation: () => clearConversation(orbit.cid), refresh: orbit.refresh,startConversation:(id:string,title:string)=>orbit.create(id,title) }), [clearConversation,orbit.cid,orbit.create,orbit.refresh]);

  const jumpedMessage=useRef('');
  useEffect(()=>{const id=new URLSearchParams(location.search).get('message');if(!id||jumpedMessage.current===location.search)return;const element=document.getElementById('orbit-message-'+id);if(element){followBottom.current=false;element.scrollIntoView({block:'center'});element.classList.add('setting-search-target');jumpedMessage.current=location.search;}},[location.search,messages]);
  const EXAMPLES = [
    '今天上午去车站接人，下午两点开会，晚上约朋友吃饭',
    '把晚饭时间改成7点',
    '今天有什么安排？',
    '北京明天天气怎么样？',
    '帮我分析一下如何安排深度工作时间',
  ];
  const conversationContent = <>
        <div className="orbit-sidebar-head"><strong>Orbit</strong></div>
        <button type="button" className="primary-button" disabled={orbit.creating || mutationBusy} onClick={() => {void orbit.create().catch(e=>orbit.setError(e.message));closeComposerMenu();}}>{orbit.creating?'正在创建…':'＋ 新对话'}</button>
        <div className="orbit-conversation-list">{orbit.conversations.map(c => {
          const key = `delete:${c.id}`, armed = confirmation.pending === key, busy = confirmation.busy === key;
          const label = `${c.is_main ? '清理主对话历史' : '删除对话'}：${c.title}`;
          return <div key={c.id} className={`orbit-conversation-row${c.id===orbit.cid?' active':''}`}>
            <button type="button" className="orbit-conversation-select" disabled={mutationBusy || orbit.creating} onClick={() => {confirmation.reset();orbit.select(c.id);setConversationDrawer(false);}} title={c.title}>{c.is_main ? <Pin size={13} aria-hidden="true"/> : null}<span>{c.title}</span>{!!c.unread && <em aria-label={`${c.unread} 条未读提醒`}>{c.unread}</em>}</button>
            <div className="orbit-conversation-actions">{!c.is_main && <button type="button" disabled={mutationBusy || orbit.creating} aria-label={`重命名对话：${c.title}`} title="重命名" onClick={()=>{setTargetConversation(c.id);setRenameTitle(c.title);closeComposerMenu();}}><Edit3 size={14}/></button>}
              <button type="button" data-confirm-action={key} aria-pressed={armed} disabled={mutationBusy || destructiveBlocked || (c.id===orbit.cid && isLoading)} aria-label={`${armed?'确认':''}${label}`} title={busy?'正在处理…':armed?`确认${label}`:label}
                onClick={()=>{void confirmation.confirm(key,async()=>{orbit.setError('');if(c.is_main)await clearConversation(c.id);else await orbit.remove(c.id);closeComposerMenu();}).catch(e=>orbit.setError(e.message));}}>{busy?<Loader2 size={14} className="animate-spin"/>:armed?<Check size={14}/>:<Trash2 size={14}/>}</button>
            </div>
          </div>;
        })}</div>

  </>;
  return (
    <div className="ai-assistant-workspace orbit-workspace">
      <aside className="orbit-conversations" aria-label="对话列表">{conversationContent}</aside>
      {composerMenuOpen && <OrbitComposerMenu ai={ai} onClose={closeComposerMenu} busy={orbit.creating || orbit.submitting || savingNotes || mutationBusy}
        autoKnowledge={orbit.autoKnowledge} onKnowledge={value=>{void orbit.preference(value).catch(e=>orbit.setError(e.message));}}
        noteMode={noteMode} attachmentsDisabled={(noteMode ? noteImages.length >= 3 || imageUpload.busy : attachments.files.length >= 3) || orbit.creating || orbit.submitting || savingNotes || mutationBusy}
        onAttach={() => { (noteMode ? noteImageInputRef : attachmentInputRef).current?.click(); setComposerMenuOpen(false); }}
        onNew={() => { setComposerMenuOpen(false); void orbit.create().catch(error => orbit.setError(error.message)); }}>
        {conversationContent}
      </OrbitComposerMenu>}
      <div className="orbit-chat-main">
      {orbit.creating && <div className="orbit-refresh-status" role="status">正在创建对话…</div>}
      {renameTitle!==null && <form className="orbit-dialog-row" onSubmit={e => {e.preventDefault();void orbit.rename(renameTitle,targetConversation).then(()=>setRenameTitle(null)).catch(e=>orbit.setError(e.message));}}><input aria-label="对话名称" value={renameTitle} maxLength={100} onChange={e=>setRenameTitle(e.target.value)} autoFocus /><button type="submit">保存</button><button type="button" onClick={()=>setRenameTitle(null)}>取消</button></form>}
      {orbit.refreshError && <div className="orbit-refresh-status" role="status">{orbit.refreshError}</div>}
      {orbit.error && <div className="orbit-error" role="alert">{orbit.error}<button type="button" onClick={()=>orbit.setError('')} aria-label="关闭提示">×</button></div>}

      <div className="flex flex-col h-full schedule-ai-panel" style={{ backgroundColor: 'var(--td-bg-color-container)' }}>
      {!collapsed && (
        <>
          {/* 对话区域 */}
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-3 py-3" onScroll={e=>{const el=e.currentTarget;followBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;if(followBottom.current)setHasNewReply(false);}}>
          <div className="schedule-ai-reading-column">
        {/* 空状态：快捷示例 */}
        {messages.length === 0 && !isLoading && (
          <div>
            <div className="text-center mb-4 pt-4">
              <div className="w-10 h-10 rounded-2xl flex items-center justify-center mx-auto mb-2"
                style={{ backgroundColor: 'var(--td-brand-color-light)' }}>
                <Bot className="w-6 h-6" style={{ color: 'var(--td-brand-color)' }} />
              </div>
              <div className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                你好，我是 Orbit
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--td-text-color-placeholder)' }}>
                安排事务、查询知识，或者继续上次的对话
              </div>
            </div>
            <div className="space-y-1.5">
              {EXAMPLES.map((ex, i) => (
                <button
                  key={i}
                  onClick={() => changeText(ex)}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg transition-all"
                  style={{
                    backgroundColor: 'var(--td-bg-color-page)',
                    color: 'var(--td-text-color-secondary)',
                    border: '1px dashed var(--td-component-stroke)',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--td-brand-color)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--td-brand-color)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--td-component-stroke)';
                    (e.currentTarget as HTMLButtonElement).style.color = 'var(--td-text-color-secondary)';
                  }}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 消息列表 */}
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            onOpenSchedule={onOpenSchedule}
            onNotificationRefresh={()=>{void orbit.refresh();window.dispatchEvent(new Event('orbit:data-change'));}}
            onReminderAction={orbit.reminderAction}
            onOpenScheduleMenu={onOpenScheduleMenu}
            onConfirmPlan={handleConfirmPlan}
            onDiscardPlan={handleDiscardPlan}
            onUpdatePlanOperation={handleUpdatePlanOperation}
            confirmingPlanId={confirmingPlanId}
            savingPlanOperationKey={savingPlanOperationKey}
          />
        ))}

        {/* 加载中 */}
        {hasNewReply&&<button type="button" className="orbit-new-reply" onClick={()=>{followBottom.current=true;setHasNewReply(false);const el=messagesContainerRef.current;el?.scrollTo({top:el.scrollHeight,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}}>有新回复 · 滚动到底部</button>}

          </div>

            <div className="orbit-request-list" aria-live="polite">{orbit.requests.filter(r=>!['completed','cancelled'].includes(r.state)).map(r=><OrbitRequestStatus key={r.id} request={r} onAction={verb=>{void orbit.action(r.id,verb).catch(e=>orbit.setError(e.message));}}/>)}</div>
          </div>

          {/* 输入框 */}
          <div
            className="flex-shrink-0 schedule-ai-composer-wrap"
            style={{ borderTop: '1px solid var(--td-component-stroke)' }}
          >
            <div className="orbit-composer-content">
              {!noteMode && notificationContext && <div className="orbit-notification-reply" role="status"><span>回复：{notificationContext.title}</span><button type="button" aria-label="清除关联通知" onClick={() => updateComposerDraft(draftKey, { notificationContext: undefined })}><X size={16} aria-hidden="true" /></button></div>}
            {!noteMode && orbit.autoKnowledge&&<button type="button" className="orbit-knowledge-chip" onClick={()=>void orbit.preference(false).catch(e=>orbit.setError(e.message))}>知识库已开启 ×</button>}
            <div className="orbit-composer-controls">
              <OrbitSegmentedControl label="发送方式" value={noteMode ? 'note' : 'command'} options={[{ value: 'command', label: '指令' }, { value: 'note', label: '记事' }]}
                disabled={orbit.creating || orbit.submitting || savingNotes || mutationBusy} onChange={value => setNoteMode(value === 'note')} />
              {!noteMode && <AiProviderSelect provider={ai.provider} disabled={ai.loading || ai.saving || orbit.creating || orbit.submitting || savingNotes || mutationBusy} onChange={provider => void ai.chooseProvider(provider)} />}
            </div>
            <div hidden={noteMode}><ChatAttachmentComposer {...attachments} inputRef={attachmentInputRef} showAddButton={false} disabled={noteMode || orbit.creating || orbit.submitting || mutationBusy} /></div>
            <NoteImageInput inputRef={noteImageInputRef} disabled={orbit.creating || imageUpload.busy || savingNotes || mutationBusy} onFiles={files => { void imageUpload.add(files); }} />
            {noteMode && <><NoteImageGallery images={noteImages} editable disabled={savingNotes || imageUpload.busy || mutationBusy} onChange={changeImages} />{imageUpload.busy && <p role="status">图片上传中…</p>}{imageUpload.error && <p role="alert" className="orbit-inline-error">{imageUpload.error}</p>}</>}
            {!noteMode && (ai.error || ai.saveError) && <button type="button" className="orbit-composer-hint is-warning" onClick={() => setComposerMenuOpen(true)}>{ai.error || ai.saveError} · 打开模型设置</button>}
            <div className={`schedule-ai-composer orbit-compact-composer${noteMode ? ' is-note-mode' : ''}`}>
              <button type="button" className="orbit-composer-plus" aria-label="更多功能" aria-haspopup="dialog" aria-expanded={composerMenuOpen}
                disabled={orbit.creating || orbit.submitting || savingNotes || mutationBusy} onClick={() => setComposerMenuOpen(true)}><Plus size={22} aria-hidden="true" /></button>
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={e => changeText(e.target.value)}
                onPaste={event => {
                  if (!noteMode) return;
                  const files = Array.from(event.clipboardData.files);
                  if (files.length) {
                    event.preventDefault();
                    const text = event.clipboardData.getData('text/plain');
                    if (text) { const field = event.currentTarget; changeText(inputText.slice(0, field.selectionStart) + text + inputText.slice(field.selectionEnd)); }
                    void imageUpload.add(files);
                  }
                }}
                onKeyDown={handleKeyDown}
                disabled={!draftReady || orbit.creating || mutationBusy}
                placeholder={noteMode ? noteImages.length ? '记录文字，与图片一起保存…' : '每行一条，或添加图片…' : '发消息或安排日程…'}
                rows={1}
                className="resize-none text-sm outline-none bg-transparent border-0 schedule-ai-composer-field"
                style={{ color: 'var(--td-text-color-primary)', border: 0, boxShadow: 'none' }}
                aria-label={noteMode ? '记事输入框' : 'AI 助手输入框'}
              />
              <span className="schedule-ai-composer-shortcut">{noteMode ? 'Enter 换行 · Ctrl+Enter 保存' : 'Enter 换行 · Ctrl+Enter 发送'}</span>
              <button
                type="button"
                onClick={noteMode ? () => { void handleSaveNotes(); } : handleSubmit}
                disabled={cannotSend}
                className="schedule-ai-send-button flex items-center justify-center rounded-lg text-xs font-medium transition-all"
                style={{
                  backgroundColor: cannotSend
                    ? 'var(--td-bg-color-component)'
                    : 'var(--td-brand-color)',
                  color: cannotSend
                    ? 'var(--td-text-color-disabled)'
                    : '#fff',
                  cursor: cannotSend ? 'not-allowed' : 'pointer',
                }}
                aria-label={noteMode ? '保存记事' : '发送'}
                title={noteMode ? 'Ctrl+Enter 保存记事' : 'Ctrl+Enter 发送'}
              >
                {orbit.submitting || savingNotes
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : noteMode ? <Save className="w-3.5 h-3.5" /> : <Send className="w-3.5 h-3.5" />
                }
                <span>{noteMode ? '保存' : '发送'}</span>
              </button>
            </div>
            </div>
          </div>
        </>
      )}
      </div>
      </div>
    </div>
  );
});
