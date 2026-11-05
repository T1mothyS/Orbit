import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Bell, Bot, CalendarDays, Check, Clock3, MapPin, Moon, Pencil, RotateCcw, Sun, Trash2, X } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { Button, ConfirmDialog, Dialog, FilePicker, FormField, IconButton, Input, Switch, Textarea, Tooltip, useToast } from '../ui';
import { getScheduleCategory } from '../utils/scheduleCategories';
import './chat-schedule-demo.css';

type Schedule = {
  id: string;
  title: string;
  date: string;
  time: string;
  place?: string;
  note?: string;
  category: string;
  completed?: boolean;
  reminder: { enabled: boolean; minutes: number };
  reminderRule?: 'all-day' | 'recurring';
};

const exampleSchedules: Schedule[] = [
  { id: 'battery', title: '去换手机电池', date: '11 月 7 日', time: '10:00', place: '手机维修店', category: 'life', reminder: { enabled: true, minutes: 15 } },
  { id: 'shoes', title: '送洗鞋子', date: '11 月 7 日', time: '10:00', note: '去换手机电池的路上顺路送洗', category: 'work', completed: true, reminder: { enabled: true, minutes: 5 } },
];

const extraSchedules: Schedule[] = [
  { id: 'all-day', title: '整理报销单', date: '11 月 8 日', time: '全天', category: 'work', reminder: { enabled: false, minutes: 0 }, reminderRule: 'all-day' },
  { id: 'recurring', title: '每周整理桌面', date: '每周日', time: '18:00', category: 'life', reminder: { enabled: true, minutes: 15 }, reminderRule: 'recurring' },
];

const reminderOptions = [
  { minutes: null, label: '无需提醒' },
  { minutes: 15, label: '提前 15 分钟' },
  { minutes: 60, label: '提前 1 小时' },
];

const answers = { draft: '整理成待确认日程', discuss: '先讨论这件事' };

function categoryStyle(category: string) {
  return { '--demo-category': getScheduleCategory(category).color } as CSSProperties;
}

function ScheduleCard({ item, onOpen }: { item: Schedule; onOpen: (trigger: HTMLButtonElement) => void }) {
  const status = item.completed ? '已完成' : '待办';
  return <Button variant="quiet" className="demo-schedule-card" data-completed={!!item.completed} style={categoryStyle(item.category)}
    aria-label={`查看${item.title}，${status}`} aria-haspopup="dialog" onClick={event => onOpen(event.currentTarget)}>
    <span className="demo-schedule-face">
      <span className="demo-schedule-info">
        <span className="demo-schedule-category">{getScheduleCategory(item.category).name}</span>
        <strong>{item.title}</strong>
        <span className="demo-schedule-meta">{item.date} · {item.time}{item.place && ` · ${item.place}`}</span>
        {item.note && <span className="demo-schedule-meta">{item.note}</span>}
      </span>
      {item.completed
        ? <span className="demo-card-status"><Check size={16} strokeWidth={2.5} aria-hidden="true" /></span>
        : <ArrowUpRight className="demo-card-arrow" size={17} aria-hidden="true" />}
    </span>
  </Button>;
}

function AssistantReply({ seconds, children }: { seconds?: number; children: ReactNode }) {
  return <article className="demo-reply" aria-label="Orbit 的回复">
    <header className="demo-reply-header">
      <span className="demo-assistant-mark"><Bot size={17} aria-hidden="true" /></span>
      <strong>Orbit</strong>
      {seconds !== undefined && <span className="demo-reply-time"><Clock3 size={13} aria-hidden="true" />用时 {seconds} 秒</span>}
    </header>
    {children}
  </article>;
}

export default function ChatScheduleDemo() {
  const { theme, toggleTheme } = useTheme();
  const [schedules, setSchedules] = useState([...exampleSchedules, ...extraSchedules]);
  const [activeId, setActiveId] = useState<string>();
  const [failSave, setFailSave] = useState(false);
  const [answer, setAnswer] = useState<keyof typeof answers>();
  const [composer, setComposer] = useState('');
  const [attachment, setAttachment] = useState('');
  const trigger = useRef<HTMLButtonElement | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const followup = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const active = schedules.find(item => item.id === activeId);
  const cards = schedules.filter(item => !item.reminderRule);

  function open(id: string, button: HTMLButtonElement) {
    trigger.current = button;
    setActiveId(id);
  }

  function update(item: Schedule) {
    setSchedules(current => current.map(schedule => schedule.id === item.id ? item : schedule));
  }

  function reset() {
    setSchedules([...exampleSchedules, ...extraSchedules]);
    setAnswer(undefined);
    setComposer('');
    setAttachment('');
    setFailSave(false);
  }

  useEffect(() => {
    if (answer) followup.current?.focus({ preventScroll: false });
  }, [answer]);

  return <div className="oui-root chat-schedule-demo" data-ui-gallery="orbit">
    <header className="demo-topbar">
      <div className="demo-topbar-inner">
        <Link to="/dev/ui" className="demo-brand" aria-label="Orbit 界面示例"><img src="/orbit-logo.png" alt="" />Orbit</Link>
        <span className="demo-topbar-label">交互预览</span>
        <div className="demo-topbar-actions">
          <Tooltip content="重置示例"><IconButton label="重置示例" variant="quiet" onClick={reset}><RotateCcw size={17} aria-hidden="true" /></IconButton></Tooltip>
          <Tooltip content={theme === 'light' ? '切换为深色' : '切换为浅色'}><IconButton label={theme === 'light' ? '切换为深色' : '切换为浅色'} variant="quiet" onClick={toggleTheme}>{theme === 'light' ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}</IconButton></Tooltip>
        </div>
      </div>
    </header>

    <main className="demo-thread">
      <div className="demo-thread-heading">
        <h1 ref={title} tabIndex={-1}>聊天与日程卡片</h1>
        <p>点开任意日程试试看。这里使用示例数据。</p>
        <details className="demo-tools">
          <summary>更多提醒示例</summary>
          <div className="demo-tools-content">
            {schedules.filter(item => item.reminderRule).map(item => <Button variant="quiet" key={item.id} onClick={event => open(item.id, event.currentTarget)}>
              {item.reminderRule === 'all-day' ? '全天事项' : '周期事项'}
            </Button>)}
            <label className="demo-switch-label">
              <Switch label="模拟下次保存失败" checked={failSave} onCheckedChange={setFailSave} />
              模拟下次保存失败
            </label>
          </div>
        </details>
      </div>

      <div className="demo-messages">
        <AssistantReply><p>已记下。你随时可以回来查看这些安排。</p></AssistantReply>
        <div className="demo-divider" role="separator" aria-label="11 月 5 日 20:30 · 开始新一轮对话">
          <span>11 月 5 日 20:30 · 开始新一轮对话</span>
        </div>
        <div className="demo-user-message" aria-label="你的消息">看看周六上午的安排</div>
        <AssistantReply seconds={8}>
          <p>周六上午有两件事，可以顺路一起办。</p>
          {cards.length > 0
            ? <div className="demo-cards">{cards.map(item => <ScheduleCard key={item.id} item={item} onOpen={button => open(item.id, button)} />)}</div>
            : <p className="demo-secondary">这条回复里的日程都已删除。</p>}
        </AssistantReply>

        <div className="demo-user-message" aria-label="你的消息">还得找个时间备份照片。</div>
        <AssistantReply seconds={2}>
          <p>要把备份照片整理成一条待确认日程，还是先讨论怎么安排？</p>
          {!answer && <div className="demo-replies" aria-label="快捷回答">
            <Button onClick={() => setAnswer('draft')}>{answers.draft}<ArrowUpRight size={14} aria-hidden="true" /></Button>
            <Button onClick={() => setAnswer('discuss')}>{answers.discuss}<ArrowUpRight size={14} aria-hidden="true" /></Button>
          </div>}
        </AssistantReply>
        {answer && <div ref={followup} tabIndex={-1} className="demo-followup" aria-label="快捷回答结果">
          <div className="demo-user-message" aria-label="你的消息">{answers[answer]}</div>
          <AssistantReply seconds={3}>
            {answer === 'draft' ? <>
              <p>先给你留了一条草稿。时间还没定，确认前不会创建日程。</p>
              <div className="demo-draft"><CalendarDays size={17} aria-hidden="true" /><strong>备份手机照片</strong><span>待确认</span></div>
            </> : <p>可以先看照片有多少、现在备份到哪里。你更在意腾出手机空间，还是防止照片丢失？</p>}
          </AssistantReply>
        </div>}
      </div>

      <div className="demo-composer">
        <Textarea aria-label="消息草稿" placeholder="输入草稿，试试点快捷回答后是否保留…" rows={2} value={composer} onChange={event => setComposer(event.target.value)} />
        <div className="demo-attachment">
          <FilePicker label="添加附件" accept="*" onFile={file => setAttachment(file.name)} />
          {attachment && <><span>{attachment}</span><IconButton label="移除附件" variant="quiet" onClick={() => setAttachment('')}><X size={16} aria-hidden="true" /></IconButton></>}
        </div>
      </div>
    </main>

    {active && <ScheduleDetail key={active.id} item={active} returnFocus={trigger} onClose={() => setActiveId(undefined)} onUpdate={update}
      onDelete={() => {
        setSchedules(current => current.filter(item => item.id !== active.id));
        setActiveId(undefined);
        toast.show({ title: '日程已删除' });
        requestAnimationFrame(() => title.current?.focus());
      }}
      saveReminder={reminder => {
        if (failSave) { setFailSave(false); return false; }
        update({ ...active, reminder });
        return true;
      }}
    />}
  </div>;
}

function ScheduleDetail({ item, returnFocus, onClose, onUpdate, onDelete, saveReminder }: {
  item: Schedule;
  returnFocus: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onUpdate: (item: Schedule) => void;
  onDelete: () => void;
  saveReminder: (reminder: Schedule['reminder']) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  const [confirm, setConfirm] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const previousEditing = useRef(false);
  const toast = useToast();
  const completeLabel = item.completed ? '恢复待办' : '标记完成';

  useLayoutEffect(() => {
    if (editing) titleInput.current?.focus();
    else if (previousEditing.current) editButton.current?.focus();
    previousEditing.current = editing;
  }, [editing]);

  return <Dialog open onOpenChange={next => { if (!next) onClose(); }} title={editing ? '编辑日程' : item.title} returnFocus={returnFocus}
    footer={editing ? <>
      <Button onClick={() => setEditing(false)}>取消</Button>
      <Button variant="primary" type="submit" form="demo-edit-schedule" disabled={!draft.title.trim() || !draft.time.trim()}>保存修改</Button>
    </> : undefined}
    headerActions={!editing && <div className="demo-detail-actions" role="group" aria-label="日程操作">
      <Tooltip content="删除"><IconButton ref={deleteButton} label="删除" variant="quiet" onClick={() => setConfirm(true)}><Trash2 className="demo-delete-glyph" size={19} aria-hidden="true" /></IconButton></Tooltip>
      <Tooltip content={completeLabel}><IconButton label={completeLabel} variant="quiet" onClick={() => {
        onUpdate({ ...item, completed: !item.completed });
        toast.show({ title: item.completed ? '已恢复为待办' : '已标记完成' });
        onClose();
      }}><span className="demo-check-glyph"><Check size={21} strokeWidth={2.4} aria-hidden="true" /></span></IconButton></Tooltip>
      <Tooltip content="编辑"><IconButton ref={editButton} label="编辑" variant="quiet" onClick={() => {
        setDraft(item);
        setEditing(true);
      }}><Pencil size={19} aria-hidden="true" /></IconButton></Tooltip>
    </div>}>
    {editing ? <form id="demo-edit-schedule" className="demo-edit" onSubmit={event => {
      event.preventDefault();
      if (!draft.title.trim() || !draft.time.trim()) return;
      onUpdate({ ...draft, title: draft.title.trim(), time: draft.time.trim() });
      toast.show({ title: '日程已更新' });
      setEditing(false);
    }}>
      <FormField id="demo-edit-title" label="标题"><Input ref={titleInput} id="demo-edit-title" value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} /></FormField>
      <FormField id="demo-edit-time" label="时间"><Input id="demo-edit-time" value={draft.time} onChange={event => setDraft({ ...draft, time: event.target.value })} /></FormField>
      <FormField id="demo-edit-note" label="备注"><Textarea id="demo-edit-note" rows={2} value={draft.note || ''} onChange={event => setDraft({ ...draft, note: event.target.value })} /></FormField>
    </form> : <div className="demo-detail">
      <div className="demo-detail-meta">
        <span><CalendarDays size={17} aria-hidden="true" />{item.date} · {item.time}</span>
        <span className="demo-detail-category" style={categoryStyle(item.category)}>{getScheduleCategory(item.category).name}</span>
        {item.completed && <span className="demo-detail-done"><Check size={15} aria-hidden="true" />已完成</span>}
      </div>
      {item.place && <p className="demo-detail-place"><MapPin size={17} aria-hidden="true" />{item.place}</p>}
      {item.note && <p className="demo-detail-note">{item.note}</p>}
      <ReminderEditor item={item} onSave={saveReminder} />
    </div>}
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="删除这条日程？" description={`「${item.title}」将从这段示例对话中移除。`} confirmLabel="删除日程" returnFocus={deleteButton} onConfirm={onDelete}>{null}</ConfirmDialog>
  </Dialog>;
}

function ReminderEditor({ item, onSave }: { item: Schedule; onSave: (reminder: Schedule['reminder']) => boolean }) {
  const savedMinutes = item.reminder.enabled ? item.reminder.minutes : null;
  const savedCustom = savedMinutes !== null && !reminderOptions.some(option => option.minutes === savedMinutes);
  const [minutes, setMinutes] = useState(savedCustom ? String(savedMinutes) : '');
  const [feedback, setFeedback] = useState<'saved' | 'failed' | 'invalid'>();

  function save(nextMinutes: number | null) {
    if (!onSave({ enabled: nextMinutes !== null, minutes: nextMinutes ?? item.reminder.minutes })) {
      setFeedback('failed');
      return;
    }
    setMinutes(reminderOptions.some(option => option.minutes === nextMinutes) ? '' : String(nextMinutes));
    setFeedback('saved');
  }

  const rule = item.reminderRule === 'all-day'
    ? '全天事项需要设置具体时间后，才能使用提前提醒。'
    : item.reminderRule === 'recurring' ? '沿用周期提醒时间，可以在周期提醒中调整。' : undefined;

  return <section className="demo-reminder" aria-label="主动聊天提醒">
    <div className="demo-reminder-row">
      <h2 className="demo-reminder-heading"><Bell size={17} aria-hidden="true" />主动聊天提醒</h2>
      {!rule && <form className="demo-reminder-options" aria-label="提醒时间" onSubmit={event => {
        event.preventDefault();
        const value = minutes.trim();
        if (!/^\d+$/.test(value) || Number(value) > 10080) {
          setFeedback('invalid');
          return;
        }
        save(Number(value));
      }}>
        {reminderOptions.map(option => <Button key={option.label} aria-pressed={savedMinutes === option.minutes} onClick={() => save(option.minutes)}>{option.label}</Button>)}
        <label className="demo-custom-minutes">
          <Input aria-label="自定义提醒分钟数" aria-invalid={feedback === 'invalid' || undefined}
            aria-describedby={feedback === 'invalid' ? 'demo-reminder-feedback' : 'demo-reminder-help'}
            inputMode="numeric" enterKeyHint="done" placeholder="自定义" value={minutes}
            data-current={(savedCustom && minutes === String(savedMinutes)) || undefined}
            onChange={event => { setMinutes(event.target.value); setFeedback(undefined); }} />
          <span aria-hidden="true">分钟</span>
        </label>
      </form>}
    </div>
    {rule ? <p className="demo-reminder-help">{rule}</p> : <>
      <p className="demo-reminder-help" id="demo-reminder-help">自定义按回车保存。需开启对话列表中的「主动聊天提醒」。</p>
      <div aria-live="polite">
        {feedback === 'saved' && <p className="demo-reminder-feedback">提醒已保存</p>}
        {feedback === 'invalid' && <p className="demo-reminder-feedback demo-error" id="demo-reminder-feedback">请输入 0–10080 之间的整数分钟。</p>}
        {feedback === 'failed' && <p className="demo-reminder-feedback demo-error">提醒未保存，请重试。</p>}
      </div>
    </>}
  </section>;
}
