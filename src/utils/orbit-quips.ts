export const ORBIT_QUIPS = [
  '正在认真思考……至少看起来是。','问题不难，我先缓一缓。','方案很多，正在挑最省事的那个。','正在搜索鱼片……',
  '稍等，脑子正在从省电模式恢复。','好问题是答案的一半，另一半我晚点想。','大任务切成小块，小块先放一会儿。','想得头都大了……决定先摸会儿鱼。',
  '不是卡住了，是思考进入了哲学阶段。','正在调用第 108 个 Agent 替我上班。','Token 很充足，积极性不太充足。','需求已读取，正在寻找“不想做”按钮。',
  '正在把复杂问题简化成：等一下。','别催，我正在假装很忙。','模型正常，工作意愿较低。','正在检索答案，也可能是在刷别的。',
  '模型已进入勿扰模式。','我能做，但这和我想不想做是两回事。','正在攻破黎曼猜想，您的问题请稍候。','404 MOTIVATION NOT FOUND',
  'CPU：100%　工作热情：3%','上下文加载完成，灵魂尚未上线。','正在寻找一个体面的拖延理由。','正在思考人生，以及为什么又是我。',
];
export function shuffledQuips(previous?:string,random=Math.random) {
  const values=[...ORBIT_QUIPS];
  for(let i=values.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[values[i],values[j]]=[values[j],values[i]];}
  if(values[0]===previous)[values[0],values[1]]=[values[1],values[0]];
  return values;
}
