import { TimePicker } from '../ui';
import { requestError } from '../utils/request-error';
import { OrbitDialog } from './OrbitDialog';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  ChevronDown,
  CheckCircle2,
  CreditCard,
  Edit3,
  Mail,
  PauseCircle,
  PlayCircle,
  Plus,
  Repeat2,
  Smartphone,

  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import type { CreditCardConfig, GenericReminderConfig, ReminderTask, ReminderTaskType, SimConfig,ReminderCycle } from '../reminder-types';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Input, RequiredMark, Select } from '../ui';

interface ReminderPageProps {
  theme?: string;
  onToggleTheme?: () => void;
  onBackToCalendar: () => void;
  user?: { email: string; role: 'admin' | 'user' } | null;
  onLogout?: () => void;
}

interface FormState {
  type: ReminderTaskType;
  name: string;
  statementDay: string;
  paymentDay: string;
  paymentMonthOffset: string;
  provider: string;
  numberMasked: string;
  region: string;
  intervalDays: string;
  lastOperationDate: string;
  actionGuide: string;
  templateKey: GenericReminderConfig['templateKey'];
  frequency: 'once' | 'monthly' | 'yearly' | 'interval';
  anchorDate: string;
  dayOfMonth: string;
  month: string;
  ruleInterval: string;
  intervalUnit: 'day' | 'month' | 'year';
  advancePolicy: 'calendar' | 'completion';
  reminderOffsets: string;
  reminderTime: string;
  priority: 'high' | 'medium' | 'low';
}

const today = () => new Date().toISOString().slice(0, 10);

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`无法读取附件：${file.name}`));
    reader.readAsDataURL(file);
  });
}
const initialForm: FormState = {
  type: 'credit_card',
  name: '',
  statementDay: '22',
  paymentDay: '20',
  paymentMonthOffset: '1',
  provider: '',
  numberMasked: '',
  region: '',
  intervalDays: '180',
  lastOperationDate: today(),
  actionGuide: '充值、消费、发送短信、拨打电话或使用流量',
  templateKey: 'custom',
  frequency: 'once',
  anchorDate: today(),
  dayOfMonth: '1',
  month: '1',
  ruleInterval: '1',
  intervalUnit: 'day',
  advancePolicy: 'calendar',
  reminderOffsets: '7,1',
  reminderTime: '12:00',
  priority: 'medium',
};

const templates: Array<{ key: GenericReminderConfig['templateKey']; name: string }> = [
  { key: 'subscription', name: '订阅续费' },
  { key: 'insurance', name: '保险' },
  { key: 'document', name: '证件' },
  { key: 'membership', name: '会员' },
  { key: 'rent', name: '房租' },
  { key: 'utilities', name: '水电账单' },
  { key: 'vehicle_inspection', name: '车辆年检' },
  { key: 'custom', name: '自定义事务' },
];

function statusLabel(status: string | undefined): { label: string; tone: string } {
  if (status === 'completed') return { label: '已完成', tone: 'success' };
  if (status === 'expired') return { label: '已逾期', tone: 'danger' };
  if (status === 'cancelled') return { label: '已停用', tone: 'muted' };
  return { label: '待处理', tone: 'info' };
}

function daysUntil(date: string | null): number | null {
  if (!date) return null;
  const start = new Date(today() + 'T00:00:00Z').getTime();
  const end = new Date(date + 'T00:00:00Z').getTime();
  return Math.round((end - start) / 86_400_000);
}

function formatDue(date: string | null): string {
  return date ? date.replace(/-/g, '.') : '尚未生成';
}

function configToForm(task: ReminderTask): FormState {
  if (task.type === 'credit_card') {
    const config = task.config as CreditCardConfig;
    return {
      ...initialForm,
      type: 'credit_card',
      name: task.name,
      statementDay: String(config.statementDay),
      paymentDay: String(config.paymentDay),
      paymentMonthOffset: String(config.paymentMonthOffset),
      reminderOffsets: (config.reminderOffsets || [15, 7, 1, 0]).join(','),
      reminderTime: config.reminderTime || '12:00',
      priority: config.priority || 'high',
    };
  }
  if (task.type === 'sim') {
    const config = task.config as SimConfig;
    return {
      ...initialForm,
      type: 'sim',
      name: task.name,
      provider: config.provider,
      numberMasked: config.numberMasked,
      region: config.region,
      intervalDays: String(config.intervalDays),
      lastOperationDate: config.lastOperationDate,
      actionGuide: config.actionGuide,
      reminderOffsets: (config.reminderOffsets || [30, 15, 7, 1, 0]).join(','),
      reminderTime: config.reminderTime || '12:00',
      priority: config.priority || 'medium',
    };
  }
  const config = task.config as GenericReminderConfig;
  const rule = config.rule;
  return {
    ...initialForm,
    type: 'generic',
    name: task.name,
    templateKey: config.templateKey,
    frequency: rule.frequency,
    anchorDate: task.currentCycle?.dueDate || rule.anchorDate,
    dayOfMonth: 'dayOfMonth' in rule ? String(rule.dayOfMonth) : rule.anchorDate.slice(8, 10),
    month: 'month' in rule ? String(rule.month) : rule.anchorDate.slice(5, 7),
    ruleInterval: 'interval' in rule ? String(rule.interval) : '1',
    intervalUnit: 'unit' in rule ? rule.unit : 'day',
    advancePolicy: rule.advancePolicy,
    reminderOffsets: config.reminderOffsets.join(','),
    reminderTime: config.reminderTime,
    priority: config.priority,
    actionGuide: config.actionGuide,
  };
}

export function ReminderPage() {
  const { authHeaders } = useAuth();
  const location = useLocation(), navigate = useNavigate();
  const [tasks, setTasks] = useState<ReminderTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formContainer, setFormContainer] = useState<HTMLFormElement | null>(null);
  const formBaseline = useRef(JSON.stringify(initialForm));
  const savingRef = useRef(false);
  const [pendingTask, setPendingTask] = useState<string | null>(null);
  const [editing, setEditing] = useState<ReminderTask | null>(null);
  const [form, setForm] = useState<FormState>(initialForm);
  const [completeTarget, setCompleteTarget] = useState<ReminderTask | null>(null);
  const [registeredCompletion, setRegisteredCompletion] = useState('');
  const [completeDate, setCompleteDate] = useState(today());
  const [completeNote, setCompleteNote] = useState('');
  const [completeAmount, setCompleteAmount] = useState('');
  const [completeBillDate, setCompleteBillDate] = useState('');
  const [completeFiles, setCompleteFiles] = useState<File[]>([]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/cycle-reminders', { headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '获取提醒失败');
      setTasks(data.tasks || []);
    } catch (error) {
      setNotice({ type: 'error', message: requestError(error, '获取提醒失败') });
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const [linkedCycle,setLinkedCycle]=useState<ReminderCycle|null>(null);
  useEffect(()=>{const q=new URLSearchParams(location.search),task=q.get('task'),cycle=q.get('cycle');setLinkedCycle(null);if(!task||!cycle)return;const c=new AbortController();void fetch('/api/cycle-reminders/'+encodeURIComponent(task)+'/history',{headers:authHeaders(),signal:c.signal}).then(async r=>{const d=await r.json();const found=d.history?.find((v:ReminderCycle)=>v.id===cycle);if(!r.ok||!found)throw new Error('周期实例不存在或无权访问');setLinkedCycle(found);}).catch(e=>{if(!c.signal.aborted)setNotice({type:'error',message:e.message});});return()=>c.abort();},[location.search,authHeaders]);
  const visibleTasks = tasks;

  const updateForm = (key: keyof FormState, value: string) => setForm(current => ({ ...current, [key]: value }));
  const openCreate = (type: ReminderTaskType = 'credit_card') => { const next = { ...initialForm, type, lastOperationDate: today() }; formBaseline.current = JSON.stringify(next); setNotice(null); setEditing(null); setForm(next); setFormOpen(true); };
  const openEdit = (task: ReminderTask) => { const next = configToForm(task); formBaseline.current = JSON.stringify(next); setNotice(null); setEditing(task); setForm(next); setFormOpen(true); };

  useEffect(() => {
    const query=new URLSearchParams(location.search);const selected=query.get('task');if(selected&&!loading&&!tasks.some(t=>t.id===selected))setNotice({type:'error',message:'周期事项不存在或无权访问'});if(selected){const element=document.getElementById('reminder-task-'+selected);element?.scrollIntoView({block:'center'});element?.classList.add('setting-search-target');}
    const taskId = query.get('edit');
    if (!taskId || !tasks.length) return;
    const task = tasks.find(item => item.id === taskId);
    if (!task) return;
    openEdit(task);
    navigate(location.pathname, { replace: true });
  }, [location.pathname, location.search, tasks, navigate]);

  const saveTask = async (event: FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setNotice(null);
    setSaving(true);
    try {
      const config = form.type === 'credit_card'
        ? {
          statementDay: Number(form.statementDay),
          paymentDay: Number(form.paymentDay),
          paymentMonthOffset: Number(form.paymentMonthOffset),
          reminderOffsets: form.reminderOffsets.split(/[,，\s]+/).map(Number).filter(value => Number.isFinite(value)),
          reminderTime: form.reminderTime,
          priority: form.priority,
        }
        : form.type === 'sim'
        ? {
          provider: form.provider,
          numberMasked: form.numberMasked,
          region: form.region,
          intervalDays: Number(form.intervalDays),
          lastOperationDate: form.lastOperationDate,
          actionGuide: form.actionGuide,
          reminderOffsets: form.reminderOffsets.split(/[,，\s]+/).map(Number).filter(value => Number.isFinite(value)),
          reminderTime: form.reminderTime,
          priority: form.priority,
        }
        : {
          templateKey: form.templateKey,
          rule: {
            frequency: form.frequency,
            anchorDate: form.anchorDate,
            dayOfMonth: Number(form.dayOfMonth),
            month: Number(form.month),
            interval: Number(form.ruleInterval),
            unit: form.intervalUnit,
            advancePolicy: form.advancePolicy,
          },
          reminderOffsets: form.reminderOffsets.split(/[,，\s]+/).map(Number).filter(value => Number.isFinite(value)),
          reminderTime: form.reminderTime,
          actionGuide: form.actionGuide,
          priority: form.priority,
        };
      const response = await fetch(editing ? '/api/cycle-reminders/' + editing.id : '/api/cycle-reminders', {
        method: editing ? 'PATCH' : 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ name: form.name, type: form.type, config }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '保存失败');
      setFormOpen(false);
      setNotice({ type: 'success', message: editing ? '提醒任务已更新' : '提醒任务已创建' });
      await loadTasks();
    } catch (error) {
      setNotice({ type: 'error', message: requestError(error, '保存失败', true) });
    } finally { savingRef.current = false; setSaving(false); }
  };

  const completeTask = async () => {
    if (!completeTarget?.currentCycle || savingRef.current) return;
    const amount = completeAmount.trim();
    if (amount && (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) > 100_000_000)) {
      return setNotice({ type: 'error', message: '金额应为非负数字，最多保留两位小数' });
    }
    if (completeFiles.length > 5 || completeFiles.some(file => file.size > 10 * 1024 * 1024)) {
      return setNotice({ type: 'error', message: '最多上传 5 个附件，每个附件不能超过 10MB' });
    }
    savingRef.current = true;
    setSaving(true); setNotice(null);
    let completionId = registeredCompletion;
    try {
      if (!completionId) {
        const response = await fetch('/api/cycle-reminders/' + completeTarget.id + '/complete', {
          method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
          body: JSON.stringify({ cycleId: completeTarget.currentCycle.id, completedDate: completeDate,
            note: completeNote, amountCents: amount ? Math.round(Number(amount) * 100) : null,
            currency: 'CNY', billDate: completeBillDate || null }),
        });
        const data = await response.json();
        if (!response.ok || !data.completion?.id) throw new Error(data.error || '登记完成失败，请重新读取事项后检查状态');
        completionId = data.completion.id;
        setRegisteredCompletion(completionId);
      }
      if (completeFiles.length) {
        const files = await Promise.all(completeFiles.map(async file => ({ name: file.name, mimeType: file.type, base64: await fileAsBase64(file) })));
        const upload = await fetch(`/api/completions/${completionId}/attachments`, {
          method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000), body: JSON.stringify({ files }),
        });
        const result = await upload.json();
        if (!upload.ok) throw new Error(result.error || '上传附件失败');
        setCompleteFiles([]);
      }
      setCompleteTarget(null); setRegisteredCompletion('');
      setNotice({ type: 'success', message: '完成记录已保存' });
      await loadTasks();
    } catch (error) {
      const message = requestError(error, '保存失败', true);
      const uncertain = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
      setNotice({ type: 'error', message: completionId ? uncertain
        ? `完成已登记，附件结果尚未确认。请先在今日完成记录中核对附件，再决定是否重试。`
        : `完成已登记，附件尚未保存：${message}。重试只上传附件，不会重复登记。` : message });
    } finally { savingRef.current = false; setSaving(false); }
  };

  const toggleTask = async (task: ReminderTask) => {
    if (pendingTask) return;
    setPendingTask(task.id);
    try {
      const response = await fetch('/api/cycle-reminders/' + task.id, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ enabled: !task.enabled }),
      });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || '更新状态失败'); }
      await loadTasks();
    } catch (error) { setNotice({ type: 'error', message: requestError(error, '更新状态失败', true) }); }
    finally { setPendingTask(null); }
  };

  const deleteTask = async (task: ReminderTask) => {
    if (pendingTask) return;
    if (!window.confirm('确定删除“' + task.name + '”及其历史记录吗？')) return;
    setPendingTask(task.id);
    try {
      const response = await fetch('/api/cycle-reminders/' + task.id, { method: 'DELETE', headers: authHeaders() });
      if (!response.ok) throw new Error('删除失败');
      setNotice({ type: 'success', message: '提醒任务已删除' });
      await loadTasks();
    } catch (error) { setNotice({ type: 'error', message: requestError(error, '删除失败', true) }); }
    finally { setPendingTask(null); }
  };

  const sendTestEmail = async () => {
    try {
      const response = await fetch('/api/cycle-reminders/test-email', { method: 'POST', headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '测试邮件发送失败');
      setNotice({ type: 'success', message: '测试邮件已发送' });
    } catch (error) { setNotice({ type: 'error', message: requestError(error, '测试邮件发送失败', true) }); }
  };

  return (
    <div className="reminder-page">
      <main className="reminder-content">
        <section className="reminder-hero"><div><div className="eyebrow">PERSONAL OPERATIONS</div><h1>周期提醒</h1></div><button className="primary-button" onClick={() => openCreate()}>+ 新建提醒</button></section>

        {notice && <div className={'notice ' + notice.type} role="status">{notice.type === 'success' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}<span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="关闭提示"><X size={15} /></button></div>}



        <section className="reminder-toolbar"><div><h2>我的提醒</h2><span>已发送的提醒会自动记录，不会重复发送。</span></div><div className="toolbar-actions"><button className="secondary-button" onClick={sendTestEmail}><Mail size={15} /> 测试邮件</button></div></section>

        {loading && !visibleTasks.length ? <div className="empty-panel"><div className="loading-dot" /><span>正在加载提醒...</span></div> : visibleTasks.length === 0 ? <div className="empty-panel"><div className="empty-icon"><BellRing size={23} /></div><h3>还没有周期提醒</h3><p>记录订阅、账单或定期事务，到期前及时提醒。</p><button className="primary-button" onClick={() => openCreate()}><Plus size={17} /> 新建第一条提醒</button></div> : (
          <section className="task-grid">{visibleTasks.map(task => {
            const cycle = task.currentCycle;
            const status = statusLabel(cycle?.status);
            const remaining = daysUntil(cycle?.dueDate || null);
            const cardConfig = task.config as CreditCardConfig;
            const simConfig = task.config as SimConfig;
            const genericConfig = task.config as GenericReminderConfig;
            return <article id={'reminder-task-'+task.id} className={!task.enabled ? 'task-card disabled' : 'task-card'} key={task.id}>
              {linkedCycle?.taskId===task.id&&<div className="settings-status" role="status">已定位周期：{linkedCycle.periodStart} — {linkedCycle.dueDate} · {statusLabel(linkedCycle.status).label}{linkedCycle.completedAt&&' · 完成 '+linkedCycle.completedAt.slice(0,10)}</div>}<div className="task-card-head"><div className={'task-type-icon ' + (task.type === 'credit_card' ? 'card' : task.type === 'sim' ? 'sim' : 'generic')}>{task.type === 'credit_card' ? <CreditCard size={20} /> : task.type === 'sim' ? <Smartphone size={20} /> : <Repeat2 size={20} />}</div><div className="task-title-wrap"><h3>{task.name}</h3></div><span className={'status-badge ' + status.tone}>{status.label}</span></div>
              <div className="task-due-block"><span>{task.type === 'credit_card' ? '本期还款日' : task.type === 'sim' ? '本次保号截止' : '本周期到期日'}</span><strong>{formatDue(cycle?.dueDate || null)}</strong><em>{remaining === null ? '—' : remaining < 0 ? '已逾期 ' + Math.abs(remaining) + ' 天' : remaining === 0 ? '今天到期' : '还有 ' + remaining + ' 天'}</em></div>
              <div className="task-details">{task.type === 'credit_card' ? <><span>账单日每月 {cardConfig.statementDay} 日</span><span>{cardConfig.paymentMonthOffset === 1 ? '次月' : '当月'} {cardConfig.paymentDay} 日还款</span><span>提前提醒：{(cardConfig.reminderOffsets || [15, 7, 1, 0]).map(value => value + ' 天').join(' · ')}</span></> : task.type === 'sim' ? <><span>{simConfig.provider || '未填写运营商'} · {simConfig.numberMasked || '未填写号码'}</span><span>每 {simConfig.intervalDays} 天检查一次</span><span>提前提醒：{(simConfig.reminderOffsets || [30, 15, 7, 1, 0]).map(value => value + ' 天').join(' · ')}</span></> : <><span>{genericConfig.actionGuide}</span><span>{genericConfig.reminderOffsets.map(value => '提前 ' + value + ' 天').join(' · ')}</span></>}</div>
              <div className="task-card-foot"><div className="task-reminder-meta"><span className="next-reminder">{task.enabled && task.nextReminderDate ? '下一提醒 ' + formatDue(task.nextReminderDate) : task.enabled ? '暂无待发送提醒' : '已暂停提醒'}</span><small className="last-reminder">{task.lastReminderDate ? '上次提醒 ' + formatDue(task.lastReminderDate) : '上次提醒：尚未发送'}</small></div><div className="card-actions">{task.enabled && cycle && cycle.status !== 'completed' && <button type="button" className="complete-button" onClick={() => { setNotice(null); setRegisteredCompletion(''); setCompleteTarget(task); setCompleteDate(today()); setCompleteNote(''); setCompleteAmount(''); setCompleteBillDate(''); setCompleteFiles([]); }}><CheckCircle2 size={15} /> 标记完成</button>}<button type="button" className="icon-button small" onClick={() => openEdit(task)} title="编辑" aria-label="编辑周期提醒"><Edit3 size={15} /></button><button type="button" className="icon-button small" onClick={() => toggleTask(task)} disabled={pendingTask === task.id} title={task.enabled ? '暂停' : '启用'} aria-label={task.enabled ? '暂停周期提醒' : '启用周期提醒'}>{task.enabled ? <PauseCircle size={15} /> : <PlayCircle size={15} />}</button><button type="button" className="icon-button small danger-button" onClick={() => deleteTask(task)} disabled={pendingTask === task.id} title="删除" aria-label="删除周期提醒"><Trash2 size={15} /></button></div></div>
            </article>;
          })}</section>
        )}
      </main>

      {formOpen && <OrbitDialog className="reminder-setup-dialog" label={editing ? '编辑周期提醒' : '新建周期提醒'} onClose={() => setFormOpen(false)} busy={saving} error={notice?.type === 'error' ? notice.message : undefined} canClose={() => JSON.stringify(form) === formBaseline.current || window.confirm('有未保存的修改，确定放弃吗？')}>{close => <>
        <form ref={setFormContainer} className="reminder-modal reminder-setup" onSubmit={saveTask} onInvalidCapture={event => {
          const details = (event.target as HTMLElement).closest('details');
          if (details) details.open = true;
        }}>
          <div className="modal-head"><h2>{editing ? '编辑周期提醒' : '新建周期提醒'}</h2><button type="button" className="icon-button" onClick={close} disabled={saving} aria-label="关闭周期提醒编辑"><X size={17} /></button></div>
          <div className="reminder-setup-body">
          {notice?.type === 'error' && <p className="orbit-inline-error" role="alert">{notice.message}</p>}
          <fieldset className="orbit-form-fields" disabled={saving}>
          <div className="reminder-setup-types" role="group" aria-label="任务类型" onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            const types: ReminderTaskType[] = ['credit_card', 'sim', 'generic'];
            const buttons = Array.from(event.currentTarget.querySelectorAll('button'));
            const focused = buttons.indexOf(event.target as HTMLButtonElement);
            const index = focused < 0 ? types.indexOf(form.type) : focused;
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
            event.preventDefault();
            updateForm('type', types[next]);
            buttons[next]?.focus();
          }}>
            <Button variant="quiet" disabled={saving} aria-pressed={form.type === 'credit_card'} onClick={() => updateForm('type', 'credit_card')}>信用卡</Button>
            <Button variant="quiet" disabled={saving} aria-pressed={form.type === 'sim'} onClick={() => updateForm('type', 'sim')}>SIM 卡</Button>
            <Button variant="quiet" disabled={saving} aria-pressed={form.type === 'generic'} onClick={() => updateForm('type', 'generic')}>生活事务</Button>
          </div>
          <div className="reminder-setup-grid reminder-setup-identity">
            <label className="form-label"><span>任务名称<RequiredMark /></span><Input required value={form.name} onChange={event => updateForm('name', event.target.value)} placeholder="例如：房租、水费或会员续费" /></label>
            <label className="form-label"><span>提醒时间<RequiredMark /></span><TimePicker label="提醒时间" value={form.reminderTime} onChange={value => updateForm('reminderTime', value)} /></label>
          </div>
          {form.type === 'credit_card' ? <div>
            <div className="reminder-setup-grid reminder-setup-credit">
              <label className="form-label reminder-setup-number"><span>每月账单日<RequiredMark /></span><Input type="number" min="1" max="31" required value={form.statementDay} onChange={event => updateForm('statementDay', event.target.value)} /></label>
              <label className="form-label reminder-setup-number"><span>还款日<RequiredMark /></span><Input type="number" min="1" max="31" required value={form.paymentDay} onChange={event => updateForm('paymentDay', event.target.value)} /></label>
              <div className="form-label"><span>还款日属于</span><Select label="还款日属于" portalContainer={formContainer} disabled={saving} value={form.paymentMonthOffset} onValueChange={value => updateForm('paymentMonthOffset', value || '0')} options={[{ value: '1', label: '出账次月' }, { value: '0', label: '出账当月' }]} /></div>
            </div>
            <p className="reminder-setup-hint">没有该日期的月份按最后一天计算。</p>
          </div> : form.type === 'sim' ? <div>
            <div className="reminder-setup-grid">
              <label className="form-label"><span>运营商<RequiredMark /></span><Input required value={form.provider} onChange={event => updateForm('provider', event.target.value)} placeholder="例如：中国移动" /></label>
              <label className="form-label"><span>号码（建议脱敏）<RequiredMark /></span><Input required value={form.numberMasked} onChange={event => updateForm('numberMasked', event.target.value)} placeholder="例如：138****1234" /></label>
              <label className="form-label reminder-setup-number"><span>周期天数<RequiredMark /></span><Input type="number" min="1" max="3650" required value={form.intervalDays} onChange={event => updateForm('intervalDays', event.target.value)} /></label>
              <label className="form-label"><span>上一次有效操作日期<RequiredMark /></span><Input type="date" required value={form.lastOperationDate} onChange={event => updateForm('lastOperationDate', event.target.value)} /></label>
            </div>
            <p className="reminder-setup-hint">下一周期会从实际完成日期重新计算。</p>
          </div> : <div className="reminder-setup-grid">
            <div className="form-label"><span>周期类型</span><Select label="周期类型" portalContainer={formContainer} disabled={saving} value={form.frequency} onValueChange={value => updateForm('frequency', value || 'once')} options={[{ value: 'once', label: '单次' }, { value: 'monthly', label: '每月' }, { value: 'yearly', label: '每年' }, { value: 'interval', label: '固定间隔' }]} /></div>
            <label className="form-label"><span>本期到期日<RequiredMark /></span><Input type="date" required value={form.anchorDate} onChange={event => updateForm('anchorDate', event.target.value)} /></label>
            {form.frequency === 'monthly' && <label className="form-label reminder-setup-number">每月几号<Input aria-label="每月几号" type="number" min="1" max="31" value={form.dayOfMonth} onChange={event => updateForm('dayOfMonth', event.target.value)} /><small>不存在该日时按月末</small></label>}
            {form.frequency === 'yearly' && <div className="reminder-setup-grid reminder-setup-date-pair"><label className="form-label reminder-setup-number">月份<Input type="number" min="1" max="12" value={form.month} onChange={event => updateForm('month', event.target.value)} /></label><label className="form-label reminder-setup-number">日期<Input type="number" min="1" max="31" value={form.dayOfMonth} onChange={event => updateForm('dayOfMonth', event.target.value)} /></label></div>}
            {form.frequency === 'interval' && <div className="reminder-setup-grid reminder-setup-date-pair"><label className="form-label reminder-setup-number">间隔<Input type="number" min="1" max="120" value={form.ruleInterval} onChange={event => updateForm('ruleInterval', event.target.value)} /></label><div className="form-label"><span>单位</span><Select label="单位" portalContainer={formContainer} disabled={saving} value={form.intervalUnit} onValueChange={value => updateForm('intervalUnit', value || 'day')} options={[{ value: 'day', label: '天' }, { value: 'month', label: '月' }, { value: 'year', label: '年' }]} /></div></div>}
            {form.frequency !== 'once' && <div className="form-label"><span>下一周期依据</span><Select label="下一周期依据" portalContainer={formContainer} disabled={saving} value={form.advancePolicy} onValueChange={value => updateForm('advancePolicy', value || 'calendar')} options={[{ value: 'calendar', label: '按原定日历' }, { value: 'completion', label: '按实际完成日' }]} /></div>}
          </div>}
          <details className="reminder-setup-more">
            <summary><span>更多设置</span><span className="reminder-setup-summary">提前 {form.reminderOffsets || '未设置'} 天 · {{ high: '高', medium: '中', low: '低' }[form.priority]}优先级{form.type === 'generic' ? ` · ${templates.find(item => item.key === form.templateKey)?.name}` : ''}</span><ChevronDown size={16} aria-hidden="true" /></summary>
            <div className="reminder-setup-grid">
              {form.type === 'generic' && <div className="form-label reminder-setup-full"><span>事务模板</span><Select label="事务模板" portalContainer={formContainer} disabled={saving} value={form.templateKey} onValueChange={value => updateForm('templateKey', value || 'custom')} options={templates.map(item => ({ value: item.key, label: item.name }))} /></div>}
              <label className="form-label">提前提醒天数<Input aria-label="提前提醒天数" value={form.reminderOffsets} onChange={event => updateForm('reminderOffsets', event.target.value)} placeholder="例如：30,7,1" /><small>逗号分隔，0 表示当天提醒</small></label>
              <div className="form-label"><span>优先级</span><Select label="优先级" portalContainer={formContainer} disabled={saving} value={form.priority} onValueChange={value => updateForm('priority', value || 'medium')} options={[{ value: 'high', label: '高' }, { value: 'medium', label: '中' }, { value: 'low', label: '低' }]} /></div>
              {form.type === 'sim' && <label className="form-label reminder-setup-full">国家/地区<Input value={form.region} onChange={event => updateForm('region', event.target.value)} placeholder="例如：中国大陆" /></label>}
              {form.type !== 'credit_card' && <label className="form-label reminder-setup-full">建议操作<Input value={form.actionGuide} onChange={event => updateForm('actionGuide', event.target.value)} /></label>}
            </div>
          </details>
          </fieldset>
          </div>
          <div className="modal-foot"><button type="button" className="secondary-button" onClick={close} disabled={saving}>取消</button><button className="primary-button" disabled={saving}>{saving ? '保存中…' : editing ? '保存修改' : '创建提醒'}</button></div>
        </form>
      </>}</OrbitDialog>}

      {completeTarget && <OrbitDialog label="登记完成" busy={saving} error={notice?.type === 'error' ? notice.message : undefined} onClose={() => { setCompleteTarget(null); if (registeredCompletion) void loadTasks(); }} canClose={() => !(completeNote || completeAmount || completeBillDate || completeFiles.length || completeDate !== today()) || window.confirm('有未保存的完成记录，确定放弃吗？')}>{close => <div className="complete-modal completion-proof-modal"><div className="complete-icon"><CheckCircle2 size={24} /></div><h2>登记“{completeTarget.name}”已完成</h2><p>{completeTarget.type === 'sim' ? '请填写实际充值、消费或其他有效操作日期。' : '可同时登记金额、账单日期和完成证明。'}</p>{notice?.type === 'error' && <p className="orbit-inline-error" role="alert">{notice.message}</p>}{registeredCompletion && <p role="status">完成已经登记；当前仅补传证明附件。</p>}<fieldset disabled={saving} className="orbit-form-fields completion-proof-grid"><label className="form-label">实际完成日期<input disabled={!!registeredCompletion} type="date" value={completeDate} onChange={event => setCompleteDate(event.target.value)} /></label><label className="form-label">金额（元，可选）<input disabled={!!registeredCompletion} inputMode="decimal" value={completeAmount} onChange={event => setCompleteAmount(event.target.value)} placeholder="例如 128.50" /></label><label className="form-label">账单日期（可选）<input disabled={!!registeredCompletion} type="date" value={completeBillDate} onChange={event => setCompleteBillDate(event.target.value)} /></label><label className="form-label full">备注（可选）<textarea disabled={!!registeredCompletion} value={completeNote} onChange={event => setCompleteNote(event.target.value)} placeholder="例如：已开启自动还款" rows={3} /></label><label className="form-label full completion-file-picker">完成证明附件<input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => setCompleteFiles(Array.from(event.target.files || []).slice(0, 5))} />{completeFiles.length > 0 && <small>{completeFiles.map(file => file.name).join('、')}</small>}</label></fieldset><div className="modal-foot"><button className="secondary-button" onClick={close} disabled={saving}>取消</button><button className="primary-button" onClick={completeTask} disabled={saving}>{saving ? '保存中…' : registeredCompletion ? '重试保存附件' : '确认完成'}</button></div></div>}</OrbitDialog>}
    </div>
  );
}
