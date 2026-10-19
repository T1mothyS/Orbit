import { useEffect,useId,useState } from 'react';
import { Link } from 'react-router-dom';
import { Button,Checkbox,HelpPopover,Input,Select,Textarea } from '../../../ui';
import {
CONTEXT_GROUPS,THESIS_FIELDS,contextAt,contextFieldErrors,contextInputWarnings,contextStockPaths,
createContextThesis,isContextObject,resolveContextThesis,
type ContextField,type ContextObject,type ContextPath
} from '../../../utils/daily-report-context';
import { useSettingsConfirm } from '../SettingsConfirm';
import { useContextState } from '../SettingsState';

export function ContextEditor({mode = 'report'}: {mode?: 'profile' | 'report'}) {
 const {owner, saved, draft, busy, error, conflict, notice} = useContextState(), confirm = useSettingsConfirm();
 const loading = busy && !saved, saving = busy && !!saved, dirty = owner.dirty(mode);
 const [openGroups,setOpenGroups] = useState<Record<string,boolean>>({profile:true,preferences:true});
 useEffect(() => { void owner.ensure(); },[owner]);
 const fieldsErrors=contextFieldErrors(owner.validationContext(mode)), warnings=contextInputWarnings(draft);
 const background=contextAt(draft,['profile','background','career_context']);
 const profileSummary=typeof background==='string' && background.trim() ? background.trim().slice(0,80) : '尚未填写背景';
 const change=owner.change;
 const setDraft=(update: (current: ContextObject)=>ContextObject)=>owner.update(update);
 const reload=async()=>{if(!owner.dirty() || await confirm('重新加载会丢弃个人资料和日报中全部未保存修改。是否重新加载？'))void owner.reload();};
 const save=()=>owner.save(mode);
  const stocks = contextStockPaths(draft);
  const frameworks: { path: ContextPath; value: ContextObject; target?: ContextPath }[] = [];
  if (isContextObject(draft.theses)) for (const [key, value] of Object.entries(draft.theses)) {
    if (isContextObject(value)) frameworks.push({ path: ['theses', key], value });
  }
  for (const targetPath of stocks) {
    const target = contextAt(draft, targetPath);
    if (!isContextObject(target)) continue;
    const resolved = resolveContextThesis(draft, target);
    if (resolved?.path[0] === 'thesis') frameworks.push({ path: [...targetPath, 'thesis'], value: resolved.value, target: targetPath });
    else if (resolved) {
      const framework = frameworks.find(item => item.path[1] === resolved.path[1]);
      if (framework && !framework.target) framework.target = targetPath;
    }
  }
  const focusFramework = (path: ContextPath) => {
    setOpenGroups(current => ({ ...current, theses: true }));
    // Open the group before moving focus; no content or paths are written to the URL.
    requestAnimationFrame(() => document.getElementById(fieldId(path))?.focus());
  };
  const targetActions = (path: ContextPath, value: ContextObject) => {
    const resolved = resolveContextThesis(draft, value);
    return <div className="context-target-actions">
      {resolved ? <Button type="button"  onClick={() => focusFramework(resolved.path[0] === 'thesis' ? [...path, 'thesis'] : resolved.path)}>编辑研究框架</Button>
        : <><span>尚无有效研究框架</span><Button type="button"  onClick={() => {
          setDraft(current => createContextThesis(current, path)); setOpenGroups(current => ({ ...current, theses: true }));
        }}>建立研究框架</Button></>}
    </div>;
  };
  return <div className="context-page" id={mode==='profile'?'library-personal-preferences':'setting-daily-report-17lgo36'} tabIndex={-1} aria-busy={loading}>
    <div className="context-shell">
      <div className="context-savebar">
        <div className="settings-heading-with-help"><span role="status">{loading ? '正在读取资料…' : saved ? dirty ? '有未保存修改' : saved.version ? `已保存 · v${saved.version}` : '尚未配置' : '资料读取失败'}{saving && ' · 正在保存…'}</span><HelpPopover label="资料保存">保存不触发日报生成或邮件发送。资料时区不改变实际任务时间。</HelpPopover></div>
        <div className="context-buttons"><Button type="button"  disabled={loading || saving || !saved || !dirty} onClick={() => { owner.reset(mode); }}>取消</Button>
          <Button type="button" variant="primary" disabled={loading || saving || !dirty || conflict || !!fieldsErrors.length} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</Button></div>
      </div>
      {error && <div className="context-notice error" role="alert"><p>{error}</p><Button type="button" disabled={saving || loading}  onClick={reload}>{conflict ? '重新加载并核对' : '重试读取'}</Button></div>}
      {notice && <p role="status" className="context-notice">{notice}</p>}
      {saved?.updatedAt && <p className="context-help" role="status">最近保存：{new Date(saved.updatedAt).toLocaleString('zh-CN')}</p>}
      {saved && !loading && <>
        {!!fieldsErrors.length && <div className="context-notice error" role="alert">{fieldsErrors.map((message, i) => <p key={i}>{message}</p>)}</div>}
        {mode === 'report' && <><p className="context-help">个人资料：{profileSummary}<HelpPopover label="个人资料用途">个人资料目前仅用于 Cloud 日报。</HelpPopover><Link to="/settings/account/profile">编辑个人资料</Link></p>
        <details className="context-warnings"><summary>Cloud 关注输入状态{warnings.length ? ` · ${warnings.length} 项提示` : ' · 完整'}</summary>
          {warnings.length ? warnings.map((message, i) => <p key={i}>{message}</p>) : <p>股票资料和研究框架满足输入规则；实际研究结果以日报运行记录为准。</p>}</details>
        </>}
        <fieldset className="context-form" disabled={saving}>
          {CONTEXT_GROUPS.filter(group => mode === 'profile' ? group.key === 'profile' : group.key !== 'profile').map(group => <details key={group.key} className="context-section" open={!!openGroups[group.key]} onToggle={event => {
            const open = event.currentTarget.open; setOpenGroups(current => current[group.key] === open ? current : { ...current, [group.key]: open });
          }}><summary>{group.label}</summary>
            {group.key === 'watchlist' && Array.isArray(draft.watchlist)
              ? <ContextFieldView field={{ key: 'watchlist', label: '股票', kind: 'objects', fields: CONTEXT_GROUPS[3].fields![1].fields }} path={['watchlist']} context={draft} onChange={change} targetActions={targetActions} />
              : <ObjectFields fields={group.fields || []} path={[group.key]} context={draft} onChange={change} targetActions={targetActions} />}
          </details>)}
          {mode === 'report' && <details className="context-section" open={!!openGroups.theses} onToggle={event => {
            const open = event.currentTarget.open; setOpenGroups(current => current.theses === open ? current : { ...current, theses: open });
          }}><summary>研究框架</summary><HelpPopover label="研究框架">从关注对象建立或编辑研究框架。这里的修改用于日报参考；正式研究观点仍在“研究与观点”中确认。</HelpPopover>
            {frameworks.length ? frameworks.map(({ path, value, target }, i) => <section className="context-item" tabIndex={-1} id={fieldId(path)} key={JSON.stringify(path)} aria-label={`研究框架第${i + 1}项`}>
              <h3>{typeof value.name === 'string' && value.name || typeof value.symbol === 'string' && value.symbol || `研究框架 ${i + 1}`}</h3>
              {!target && <p className="context-help">当前没有有效关联的关注对象，内容仍保留。</p>}
              <ObjectFields fields={THESIS_FIELDS} path={path} context={draft} onChange={(fieldPath, value) => {
                const key = fieldPath[fieldPath.length - 1];
                if (target && ['name', 'symbol'].includes(String(key)) && fieldPath.length === path.length + 1) change([...target, key], value);
                else change(fieldPath, value);
              }} />
            </section>) : <p className="context-help">还没有研究框架，可在关注对象下建立。</p>}
          </details>}
        </fieldset>
        <nav className="context-related" aria-label="相关设置"><Link to="/library/settings?settings=library-full-export">知识库导出</Link><Link to="/library/settings?settings=setting-library-16152wn">知识库发布设置</Link><Link to="/reports/settings?settings=setting-daily-report-16vp9eg">日报接收设置</Link></nav>
      </>}
    </div>
  </div>;
}

const hiddenFields = new Set(['version', 'updated_at', 'id', 'thesis_file', 'thesis']);
const extraLabels: Record<string, string> = { rationale: '研究理由', signal: '观察信号', positive_signals: '支持信号', risks: '风险', disconfirming_evidence: '反证', questions: '核查问题', focus: '关注角度' };
const fieldId = (path: ContextPath) => 'context-' + path.map(String).map(encodeURIComponent).join('-');
interface FieldProps {
  context: ContextObject;
  path: ContextPath;
  onChange: (path: ContextPath, value: unknown) => void;
  targetActions?: (path: ContextPath, value: ContextObject) => React.ReactNode;
}
function ObjectFields({ fields, context, path, onChange, targetActions }: FieldProps & { fields: ContextField[] }) {
  const value = contextAt(context, path);
  if (value !== undefined && value !== null && !isContextObject(value)) return <p className="context-help" role="alert">这一组资料格式不兼容，原内容已保留，请先核对资料。</p>;
  const known = new Set(fields.map(field => field.key));
  const extra = isContextObject(value) ? Object.entries(value).filter(([key]) => !known.has(key) && !hiddenFields.has(key)).map(([key, item]): ContextField => ({
    key, label: extraLabels[key] || key, kind: isContextObject(item) ? 'object' : Array.isArray(item) ? item.length && item.every(isContextObject) ? 'objects' : 'texts' : typeof item === 'number' ? 'number' : typeof item === 'boolean' ? 'boolean' : 'text', fields: [],
  })) : [];
  return <div className="context-fields">{[...fields, ...extra].map(field => <ContextFieldView key={field.key} field={field} context={context} path={[...path, field.key]} onChange={onChange} targetActions={targetActions} />)}</div>;
}
function ContextFieldView({ field, context, path, onChange, targetActions }: FieldProps & { field: ContextField }) {
  const id = useId(), value = contextAt(context, path);
  if (field.kind === 'object') return <section className="context-subgroup"><h3>{field.label}</h3><ObjectFields fields={field.fields || []} context={context} path={path} onChange={onChange} targetActions={targetActions} /></section>;
  if (field.kind === 'texts' || field.kind === 'objects') {
    if (value !== undefined && value !== null && !Array.isArray(value)) return <p role="alert" className="context-help">{field.label}列表格式不兼容，原内容已保留。</p>;
    const items = Array.isArray(value) ? value : [];
    return <section className="context-list" aria-label={field.label}><h3>{field.label}</h3>
      {items.map((item, index) => <div className={field.kind === 'objects' ? 'context-item' : 'context-text-item'} key={index}>
        {field.kind === 'objects' ? <><div className="context-item-head"><h4>{field.label} {index + 1}</h4><Button type="button" variant="quiet" aria-label={`移除${field.label}第${index + 1}项`} onClick={() => onChange(path, items.filter((_, i) => i !== index))}>移除</Button></div>
          {isContextObject(item) ? <><ObjectFields fields={field.fields || []} context={context} path={[...path, index]} onChange={onChange} />
            {targetActions && contextStockPaths(context).some(p => JSON.stringify(p) === JSON.stringify([...path, index])) && targetActions([...path, index], item)}</> : <p role="alert">这一项格式不兼容，原内容已保留；可明确移除这一项。</p>}</>
          : <><Textarea aria-label={`${field.label}第${index + 1}项`} compact autoGrow rows={1} value={typeof item === 'string' ? item : ''} disabled={typeof item !== 'string'} onChange={event => onChange([...path, index], event.target.value)} />
            <Button type="button" variant="quiet" aria-label={`移除${field.label}第${index + 1}项`} onClick={() => onChange(path, items.filter((_, i) => i !== index))}>移除</Button></>}
      </div>)}
      <Button type="button"  disabled={items.length >= 200} onClick={() => {
        const targetList = field.label === '股票' || field.label === '公司';
        const initial = field.kind === 'objects' ? targetList ? { name: '', symbol: '', priority: 'medium', sectors: [] } : {} : '';
        onChange(path, [...items, initial]);
      }}>添加{field.label}</Button>
    </section>;
  }
  const incompatible = value !== undefined && value !== null && typeof value !== (field.kind === 'number' ? 'number' : field.kind === 'boolean' ? 'boolean' : 'string');
  return <div className="context-field"><label htmlFor={id}>{field.label}</label>
    {incompatible ? <p role="alert">格式不兼容，原内容已保留。</p> : field.kind === 'select'
      ? <Select id={id} label={field.label} value={typeof value === 'string' ? value : ''} onValueChange={value => onChange(path, value || '')} options={[{value:'',label:'未设置'}, ...(typeof value === 'string' && value && !field.options?.some(option => option[0] === value) ? [{value,label:value}] : []), ...(field.options || []).map(([value,label])=>({value,label}))]} />
      : field.kind === 'boolean' ? <Checkbox id={id} label={field.label} checked={value === true} onCheckedChange={value => onChange(path, value)} />
      : field.kind === 'number' ? <Input id={id} type="number" min={1} step={1} value={typeof value === 'number' ? value : ''} onChange={event => onChange(path, event.target.value === '' ? undefined : Number(event.target.value))} />
      : <Textarea id={id} compact autoGrow rows={1} value={typeof value === 'string' ? value : ''} onChange={event => onChange(path, event.target.value)} />}
  </div>;
}
