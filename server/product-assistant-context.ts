import { searchProductHelp } from './product-help.js';
import { querySystem } from './system-query.js';
import { getUserById, getReminder } from './db.js';
import { todayInTimezone } from './reminder-store.js';
import { isOrbitDiagnosticQuestion, isOrbitProductQuestion } from './product-assistant-intent.js';
// Mandatory evidence for product questions, even if a provider does not request tools.
export function productAssistantContext(userId: string, text: string) {
  const admin = getUserById(userId)?.role === 'admin';
  const evidence: unknown[] = [];
  if (isOrbitProductQuestion(text)) evidence.push(searchProductHelp(text.slice(0,300), admin));
  if (isOrbitDiagnosticQuestion(text)) {
    let date = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    if (!date && /昨天|昨日|前天/.test(text)) {
      const today = todayInTimezone(getReminder(userId)?.timezone || 'Asia/Shanghai');
      date = new Date(Date.parse(today + 'T00:00:00Z') - (/前天/.test(text) ? 2 : 1) * 86400000).toISOString().slice(0,10);
    }
    if (/日报/.test(text)) evidence.push(querySystem(userId,'daily-report-status',{date,source:/Shadow/i.test(text)?'shadow':/本地/.test(text)?'local':undefined}));
    else if (/提醒|通知/.test(text)) evidence.push(querySystem(userId,'reminder-status'));
    else if (/部署/.test(text)) evidence.push(querySystem(userId,'deployments'));
    else if (/后台任务/.test(text)) evidence.push(querySystem(userId,'tasks'));
    else if (/报错|错误/.test(text) && admin) evidence.push(querySystem(userId,'errors'));
    evidence.push(querySystem(userId,'status'));
    if (/报错|错误/.test(text) && !admin) evidence.push({domain:'runtime',status:'forbidden',reason:'全站错误摘要仅管理员可读取；可以查询自己的任务'});
  }
  return evidence;
}
