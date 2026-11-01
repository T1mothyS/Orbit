import { isOrbitDiagnosticQuestion } from './product-assistant-intent.js';
export function isReadOnlyScheduleQuery(text: string): boolean {
  const normalized = text.replace(/\s+/g, '');
  if (/(添加|新建|创建|修改|改成|推迟|提前|取消|删除|删掉|标记完成|帮我安排|给我安排|提醒我)/.test(normalized)) {
    return false;
  }
  if(/(?:今天|今日|明天|本周|下周).*?(?:有啥.*(?:做|干|安排)|有什么要(?:做|干)|要做什么|要干什么)/.test(normalized))return true;
  return /(有什么安排|有哪些安排|什么安排|有什么日程|有哪些日程|有哪些待办|有什么(?:事情?|任务|待办)(?:要|需要|得)?(?:做|干|处理|办)?|(?:今天|今日|明天|本周|下周).*?(?:要做什么|要干什么|要处理什么|有什么要做|有什么要干)|查看.*(?:安排|日程|待办)|查询.*(?:安排|日程|待办)|几点有会)/.test(normalized);
}

const KNOWLEDGE_CONTEXT_TRIGGER = /知识库|knowledge\s+library/i;

export function requestsKnowledgeContext(text: string): boolean {
  return KNOWLEDGE_CONTEXT_TRIGGER.test(text);
}

export function needsScheduleContext(text: string): boolean {
  const normalized = text.replace(/\s+/g, '');
  if (isReadOnlyScheduleQuery(normalized)) return true;
  if (/(日程|安排|待办|提醒|会议|行程|空闲|有空|冲突|改期|推迟|提前|标记完成)/.test(normalized)) return true;
  const hasDateOrTime = /(今天|明天|后天|大后天|本周|下周|周[一二三四五六日天]|星期[一二三四五六日天]|\d{1,2}[月号日点时]|上午|下午|晚上)/.test(normalized);
  const hasAction = /(去|到|见|开|办|做|交|取|送|买|看|体检|出发|出差|预约|拜访|聚会|吃饭|运动|学习|提交)/.test(normalized);
  return hasDateOrTime && hasAction;
}

/** A plain answer has no action authority. Keep schedule requests on the strict draft protocol. */
export function allowsPlainChatReply(text: string, context: { activePlan?: boolean; scoped?: boolean } = {}): boolean {
  if (context.activePlan || context.scoped) return false;
  const normalized = text.replace(/\s+/g, '').replace(/不(?:进行)?(?:任何)?日程操作|不操作日程/g, '');
  return !needsScheduleContext(normalized)
    && !/(提醒我|安排|日程|待办|会议|行程|标记.*完成|取消|删除|删掉|修改|改成|改到|调到|换到|挪到|移到|推迟|提前|新建|创建|添加|schedule|calendar|remind|appointment|meeting)/i.test(normalized);
}

function declinesScheduleDraft(text: string): boolean {
  return /(?:不要|不用|不需要|先别|暂不|别再).{0,8}(?:创建|新建|添加|生成|安排|提醒|修改|删除|取消)/.test(text)
    || /(?:只|先)(?:聊聊|讨论|解释)|^(?:算了|取消|不做了)[。！!\s]*$/.test(text);
}

function isScheduleFollowUp(text: string): boolean {
  if (declinesScheduleDraft(text)) return false;
  return /^(?:好的?|可以|确认|确定|没问题|就这样|按这个|按上面|照这个)[。！!\s]*$/.test(text)
    || /^(?:单独建|其余|后[一二三四五六七八九十\d]+项)/.test(text)
    || /^(?:这是|是指|是|改为|换成|时间|日期|都按|就按|按)?\s*(?:[上下本这]?(?:周|星期)[一二三四五六日天]|今天|明天|后天|\d{1,2}[月号日点时]|\d{1,2}[:：]\d{2}|上午|下午|中午|晚上)/.test(text)
    || isActivityDescription(text);
}

export function scheduleDraftContext(previousTexts: string[]): string[] {
  const context: string[] = [];
  for (const text of previousTexts.slice(0, 6)) {
    if (declinesScheduleDraft(text) || isReadOnlyScheduleQuery(text)) break;
    context.push(text);
    if (requestsScheduleDraft(text) || isActivityDescription(text)) return context;
    if (/[?？]|如何|怎么|为什么/.test(text) || !isScheduleFollowUp(text)) break;
  }
  return [];
}

/** Recent user turns are newest first and must belong to the same unfinished dialogue. */
export function requestsScheduleDraft(text: string, previousTexts: string[] = []): boolean {
  const normalized = text.trim();
  if (/^(如何|怎么|怎样|为什么|请问.*如何)/.test(normalized) || declinesScheduleDraft(normalized) || isReadOnlyScheduleQuery(normalized)) return false;
  if (/(?:添加|新建|创建|(?:生成|整理).*?(?:草稿|待确认|日程|待办|事项|任务)|安排|提醒我|修改|改成|改到|调到|推迟|提前|取消|删除|删掉|标记.*完成)/.test(normalized)) return true;
  return previousTexts.length > 0 && !/[?？]|如何|怎么|为什么/.test(normalized)
    && isScheduleFollowUp(normalized) && scheduleDraftContext(previousTexts).length > 0;
}
export function isActivityDescription(text: string): boolean {
  return !declinesScheduleDraft(text) && needsScheduleContext(text) && !isReadOnlyScheduleQuery(text) && !requestsScheduleDraft(text)
    && !/[?？]|如何|怎么|为什么|有没有|是否|冲突/.test(text);
}
export function chatToolNames(text: string, options: { product: boolean; schedule: boolean; knowledge: boolean; history: boolean }) {
  const names = new Set<string>();
  if (options.product) for (const name of ['settings','product_help']) names.add(name);
  if (options.product&&isOrbitDiagnosticQuestion(text)) for (const name of ['system_status','deployment_status','task_status','daily_report_status','reminder_status','recent_errors']) names.add(name);
  if (options.schedule) names.add('calendar');
  if (/日报|reports/i.test(text)) names.add('reports');
  if (options.knowledge) names.add('knowledge');
  if (options.history) names.add('history');
  if (/搜索|联网|查证|查一下|最新|新闻|官网|https?:\/\/|如何|怎么|教程|接入|配置/i.test(text)) for (const name of ['search','read_url']) names.add(name);
  return names;
}
