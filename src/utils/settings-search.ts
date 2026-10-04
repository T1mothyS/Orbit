export interface SearchableSetting {id:string;section:string;label:string;description:string;keywords:string[]}
const aliases:Record<string,string[]>={
 '导出全库':['知识库','library','knowledge','export','下载','备份知识库'],
 '开启每日提醒':['每日总结','每天的总结','每天总结','日程摘要','每天发送','每日提醒'],
 'Orbit Weekly':['周报','每周总结','weekly','周期复盘','周期报告'], '用户头像':['头像','照片','个人入口'],
 '个人 API Key':['密钥','workbuddy','codebuddy','apikey','api key'], 'AI 连接状态':['连接','认证','登录','验证'], '日程 AI 模型':['model','glm','minimax','模型选择'],
 'ChatGPT 套餐连接':['openai','oauth','plus','pro','chatgpt','登录'], '联网搜索':['搜索','search','tavily','联网','网页'],
 '常驻城市或区县':['天气','weather','城市','地点'], '客户端授权码':['smtp','imap','qq','密码'], 'QQ 邮箱账号':['email','mail','邮箱'],
 '免打扰时段':['安静','勿扰','静默','quiet'], '通知渠道':['提醒','邮件','浏览器','站内通知','主动聊天提醒','聊天提醒'], '备份密码':['backup','恢复','加密'], '选择备份文件':['restore','恢复','导入'],
 '可读数据导出':['export','json','csv','下载'], '日报令牌':['daily','token','日报','发布'], '云端 Context':['cloud','context','日报','上下文'],
 '知识库发布令牌':['knowledge','library','token','知识库'], '自动同步':['caldav','荣耀','日历'], '同步状态':['caldav','荣耀','日历'],
 '管理面板':['admin','用户','日志','全站备份'], 'Tools 工具中心':['挂载','工具','tools'],
};
export function settingId(section:string,label:string):string {
  let hash=2166136261;for(const c of label)hash=Math.imul(hash^c.charCodeAt(0),16777619);
  return `setting-${section}-${(hash>>>0).toString(36)}`;
}
export const settingKeywords=(label:string)=>aliases[label]||[];
const normalise=(s:string)=>s.toLocaleLowerCase().replace(/[\s_-]+/g,'');
function ordered(query:string,text:string):boolean {let i=0;for(const c of text){if(c===query[i])i++;if(i===query.length)return true;}return false;}
function typo(a:string,b:string):boolean {
  if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,errors=0;
  while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++errors>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}
  return errors+(i<a.length||j<b.length?1:0)<=1;
}
export function searchSettings(items:SearchableSetting[],raw:string):SearchableSetting[] {
  const query=normalise(raw).slice(0,80);if(!query)return [];
  return items.map(item=>{
    const label=normalise(item.label),keywords=item.keywords.map(normalise),description=normalise(item.description);
    let score=label===query?100:label.includes(query)||query.includes(label)?85:keywords.some(k=>k===query)?80:keywords.some(k=>k.includes(query)||(k.length>1&&query.includes(k)))?70:description.includes(query)?55:query.length>1&&ordered(query,label)?45:0;
    if(!score&&/^[a-z]{4,32}$/.test(query)&&[label,...keywords].some(t=>t.split(/[^a-z]/).some(w=>typo(query,w))))score=35;
    return {item,score};
  }).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||a.item.label.localeCompare(b.item.label,'zh')).slice(0,12).map(r=>r.item);
}
