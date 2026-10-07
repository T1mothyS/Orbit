// Shared form fields and reader rules. Context stays in the existing account store.
export type ContextObject = Record<string, unknown>;
export type ContextPath = (string | number)[];
export interface ContextField {
  key: string;
  label: string;
  kind: 'text' | 'number' | 'boolean' | 'select' | 'texts' | 'object' | 'objects';
  fields?: ContextField[];
  options?: [string, string][];
}
const text = (key: string, label: string): ContextField => ({ key, label, kind: 'text' });
const texts = (key: string, label: string): ContextField => ({ key, label, kind: 'texts' });
const object = (key: string, label: string, fields: ContextField[]): ContextField => ({ key, label, kind: 'object', fields });
const objects = (key: string, label: string, fields: ContextField[]): ContextField => ({ key, label, kind: 'objects', fields });
const priority: ContextField = { key: 'priority', label: '优先级', kind: 'select', options: [['high', '高'], ['medium', '中'], ['low', '低']] };
const targetFields = [text('name', '名称'), text('symbol', '代码'), priority, texts('sectors', '关联行业'), texts('focus', '关注角度')];
export const THESIS_FIELDS: ContextField[] = [
  text('name', '名称'), text('symbol', '代码'), text('status', '研究状态'), priority,
  object('thesis', '研究内容', [text('one_liner', '核心判断'),
    objects('pillars', '研究支柱', [text('title', '支柱标题'), texts('questions', '核查问题'), texts('positive_signals', '支持信号'), texts('risks', '风险')]),
    texts('positive_signals', '支持信号'), texts('risks', '风险'),
    object('valuation_framework', '估值框架', [texts('preferred_methods', '分析方法'), texts('key_variables', '关键变量'), texts('avoid', '避免的方法')]),
    texts('disconfirming_evidence', '反证')]),
  object('monitor', '监测指标', [texts('earnings', '财报指标'), texts('industry', '行业指标'), texts('narrative', '叙事与预期')]),
];
export const CONTEXT_GROUPS: ContextField[] = [
  object('profile', '个人资料', [
    object('identity', '语言与资料时区', [text('language', '语言'), text('timezone', '资料时区')]),
    object('background', '个人背景', [texts('education', '教育背景'), text('career_context', '职业背景')]),
    texts('professional_interests', '长期专业兴趣'),
    objects('research_projects', '研究项目', [text('name', '项目名称'), text('status', '项目状态'), texts('topics', '项目主题')]),
    object('information_preferences', '分析与回答偏好', [texts('answer_style', '回答风格'), texts('finance_analysis', '金融分析偏好'), texts('technology_preferences', '技术方案偏好')]),
  ]),
  object('preferences', '日报偏好', [texts('prefer', '偏好内容'), texts('avoid', '避免内容'),
    { key: 'target_reading_time_minutes', label: '目标阅读时长（分钟）', kind: 'number' }, texts('evidence_policy', '证据要求')]),
  object('recent_interests', '近期兴趣', [objects('topics', '兴趣主题', [text('topic', '主题'), priority, text('recency', '新鲜度描述'), texts('keywords', '关键词')])]),
  object('watchlist', '关注名单', [objects('sectors', '行业', [text('name', '行业名称'), priority, texts('focus', '关注角度')]),
    objects('stocks', '股票', targetFields), objects('companies', '公司', targetFields)]),
];
export function isContextObject(value: unknown): value is ContextObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function contextAt(context: ContextObject, path: ContextPath): unknown {
  let value: unknown = context;
  for (const key of path) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = (value as ContextObject)[key];
  }
  return value;
}
export function setContextAt(context: ContextObject, path: ContextPath, value: unknown): ContextObject {
  if (!path.length || path.some(key => ['__proto__', 'constructor', 'prototype'].includes(String(key)))) throw new Error('无效字段');
  const next = structuredClone(context);
  let parent: ContextObject | unknown[] = next;
  for (let index = 0; index < path.length - 1; index++) {
    const key = path[index];
    let child = (parent as ContextObject)[key];
    if (!child || typeof child !== 'object') {
      child = typeof path[index + 1] === 'number' ? [] : {};
      (parent as ContextObject)[key] = child;
    }
    parent = child as ContextObject;
  }
  const key = path[path.length - 1];
  if (value === undefined) delete (parent as ContextObject)[key];
  else (parent as ContextObject)[key] = value;
  return next;
}
export function contextStockPaths(context: ContextObject): ContextPath[] {
  if (Array.isArray(context.watchlist)) return context.watchlist.map((_, index) => ['watchlist', index]);
  const watchlist = isContextObject(context.watchlist) ? context.watchlist : {};
  return ['stocks', 'companies'].flatMap(key => Array.isArray(watchlist[key]) ? (watchlist[key] as unknown[]).map((_, index) => ['watchlist', key, index]) : []);
}
export function resolveContextThesis(context: ContextObject, target: ContextObject): { value: ContextObject; path: ContextPath } | null {
  if (isContextObject(target.thesis)) return { value: target.thesis, path: ['thesis'] };
  const match = typeof target.thesis_file === 'string' ? /^theses\/([A-Za-z0-9_-]+)\.ya?ml$/.exec(target.thesis_file) : null;
  const candidate = match && isContextObject(context.theses) ? context.theses[match[1]] : null;
  return isContextObject(candidate) && typeof candidate.symbol === 'string' && typeof target.symbol === 'string'
    && candidate.symbol.toLowerCase() === target.symbol.trim().toLowerCase()
    ? { value: candidate, path: ['theses', match![1]] } : null;
}
export function stockContextDetail(context: ContextObject, stock: ContextObject) {
  const thesis = resolveContextThesis(context, stock)?.value;
  const complete = typeof stock.name === 'string' && !!stock.name.trim() && typeof stock.symbol === 'string' && !!stock.symbol.trim()
    && typeof stock.priority === 'string' && !!stock.priority.trim()
    && Array.isArray(stock.sectors) && stock.sectors.every(sector => typeof sector === 'string' && !!sector.trim())
    && thesis && typeof thesis.status === 'string' && !!thesis.status.trim() && typeof thesis.priority === 'string' && !!thesis.priority.trim()
    && isContextObject(thesis.thesis) && isContextObject(thesis.monitor);
  const detail = complete ? JSON.stringify({ priority: stock.priority, sectors: stock.sectors,
    thesis: { status: thesis!.status, priority: thesis!.priority, thesis: thesis!.thesis, monitor: thesis!.monitor } }) : '';
  return { detail: detail.length <= 4000 ? detail : '', issue: !complete ? '缺少必要资料或有效研究框架' : detail.length > 4000 ? '研究框架超过 Cloud 输入长度限制，请精简' : null };
}
// Only known fields are typed; existing extension fields and metadata remain untouched.
export function contextFieldErrors(context: ContextObject): string[] {
  const errors: string[] = [];
  const visit = (value: unknown, fields: ContextField[], label: string) => {
    if (value === undefined || value === null) return;
    if (!isContextObject(value)) { errors.push(`${label}应为一组资料`); return; }
    for (const field of fields) {
      const item = value[field.key], name = `${label} / ${field.label}`;
      if (item === undefined || item === null) continue;
      if (field.kind === 'object') visit(item, field.fields || [], name);
      else if (field.kind === 'objects') {
        if (!Array.isArray(item)) errors.push(`${name}应为列表`);
        else item.forEach((row, i) => { if (!isContextObject(row)) errors.push(`${name}第${i + 1}项应为一组资料`); else visit(row, field.fields || [], `${name}第${i + 1}项`); });
      } else if (field.kind === 'texts') {
        if (!Array.isArray(item) || item.some(row => typeof row !== 'string')) errors.push(`${name}应为文字列表`);
      } else if (field.kind === 'number') {
        if (!Number.isSafeInteger(item) || (item as number) <= 0) errors.push(`${name}应为正整数`);
      } else if (field.kind === 'boolean') { if (typeof item !== 'boolean') errors.push(`${name}应为开关值`); }
      else if (typeof item !== 'string') errors.push(`${name}应为文字`);
    }
  };
  for (const group of CONTEXT_GROUPS) {
    if (group.key === 'watchlist' && Array.isArray(context.watchlist)) context.watchlist.forEach((row, i) => visit(row, targetFields, `股票第${i + 1}项`));
    else visit(context[group.key], group.fields || [], group.label);
  }
  if (context.theses !== undefined && context.theses !== null) {
    if (!isContextObject(context.theses)) errors.push('研究框架应为一组资料');
    else Object.values(context.theses).forEach(value => visit(value, THESIS_FIELDS, '研究框架'));
  }
  for (const path of contextStockPaths(context)) {
    const target = contextAt(context, path);
    if (isContextObject(target) && target.thesis !== undefined) visit(target.thesis, THESIS_FIELDS, '关注对象的研究框架');
  }
  const identity = contextAt(context, ['profile', 'identity']);
  if (isContextObject(identity) && typeof identity.timezone === 'string' && identity.timezone.trim()) {
    try { new Intl.DateTimeFormat('zh-CN', { timeZone: identity.timezone }); } catch { errors.push('资料时区无效，请使用 Asia/Shanghai 等时区名称'); }
  }
  return errors;
}
export function contextInputWarnings(context: ContextObject): string[] {
  const stocks = Array.isArray(context.watchlist) ? context.watchlist : isContextObject(context.watchlist) ? context.watchlist.stocks : undefined;
  if (stocks === undefined || (Array.isArray(stocks) && !stocks.length)) return ['尚未配置股票关注名单'];
  if (!Array.isArray(stocks)) return ['股票关注名单格式无效，Cloud 输入不完整'];
  return [...(stocks.length > 100 ? ['股票关注超过 100 项，Cloud 输入仅覆盖前 100 项'] : []), ...stocks.flatMap((stock, index) => {
    if (!isContextObject(stock)) return [`股票第${index + 1}项格式无效，Cloud 输入不完整`];
    const issue = stockContextDetail(context, stock).issue;
    if (issue) return [`股票第${index + 1}项输入不完整：${issue}`];
    const thesis = resolveContextThesis(context, stock)?.value.thesis;
    return isContextObject(thesis) && !Object.keys(thesis).length ? [`股票第${index + 1}项输入不完整：研究内容尚未填写`] : [];
  })];
}
export function createContextThesis(context: ContextObject, targetPath: ContextPath): ContextObject {
  const target = contextAt(context, targetPath);
  if (!isContextObject(target)) return context;
  const theses = isContextObject(context.theses) ? context.theses : {};
  let index = 1;
  while (Object.hasOwn(theses, `subject-${index}`)) index++;
  const key = `subject-${index}`;
  let next = setContextAt(context, ['theses', key], { name: target.name || '', symbol: target.symbol || '', status: 'draft', priority: target.priority || 'medium', thesis: {}, monitor: {} });
  next = setContextAt(next, [...targetPath, 'thesis_file'], `theses/${key}.yaml`);
  return next;
}
// Keep a linked framework valid when changing a target's identity; split shared references.
export function updateContextField(context: ContextObject, path: ContextPath, value: unknown): ContextObject {
  let next = setContextAt(context, path, value);
  const field = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  const isTarget = contextStockPaths(context).some(targetPath => JSON.stringify(targetPath) === JSON.stringify(parentPath));
  if (!isTarget || !['symbol', 'name'].includes(String(field))) return next;
  const target = contextAt(context, parentPath);
  const resolved = isContextObject(target) ? resolveContextThesis(context, target) : null;
  if (!resolved) return next;
  if (resolved.path[0] === 'thesis') {
    if (Object.hasOwn(resolved.value, field)) next = setContextAt(next, [...parentPath, 'thesis', field], value);
  } else {
    const shared = contextStockPaths(context).filter(p => {
      const other = contextAt(context, p);
      return isContextObject(other) && other.thesis_file === (target as ContextObject).thesis_file;
    }).length > 1;
    if (shared) {
      next = createContextThesis(next, parentPath);
      const newTarget = contextAt(next, parentPath) as ContextObject;
      const newPath = resolveContextThesis(next, newTarget)!.path;
      next = setContextAt(next, newPath, { ...structuredClone(resolved.value), [field]: value });
    } else next = setContextAt(next, [...resolved.path, field], value);
  }
  return next;
}
