import assert from 'node:assert/strict';
import test from 'node:test';
import { isReadOnlyScheduleQuery, needsScheduleContext, requestsKnowledgeContext, allowsPlainChatReply, requestsScheduleDraft, scheduleDraftContext } from './ai-intent.js';

test('普通问答和闲聊不加载用户日程上下文', () => {
  assert.equal(needsScheduleContext('讲一个简短的笑话'), false);
  assert.equal(needsScheduleContext('解释一下量子纠缠'), false);
  assert.equal(needsScheduleContext('明天天气怎么样'), false);
});

test('日程查询、写入和带时间的行动请求会加载日程上下文', () => {
  assert.equal(needsScheduleContext('明天有什么安排'), true);
  assert.equal(needsScheduleContext('把周会推迟到周五'), true);
  assert.equal(needsScheduleContext('明天下午三点去医院'), true);
  assert.equal(needsScheduleContext('提醒我晚上交报告'), true);
});

test('只读日程查询不会被写入动词误判', () => {
  assert.equal(isReadOnlyScheduleQuery('查看明天的日程'), true);
  assert.equal(isReadOnlyScheduleQuery('帮我安排明天下午开会'), false);
  assert.equal(isReadOnlyScheduleQuery('删除明天的会议'), false);
});

test('只有明确提到知识库才请求知识库上下文', () => {
  assert.equal(requestsKnowledgeContext('明天 9 点开会'), false);
  assert.equal(requestsKnowledgeContext('参考以前的资料安排会议'), false);
  assert.equal(requestsKnowledgeContext('请参考知识库安排明天的会议'), true);
  assert.equal(requestsKnowledgeContext('Please check the Knowledge Library for this'), true);
  assert.equal(requestsKnowledgeContext('请参考历史记录和个人笔记'), false);
});

test('plain chat fallback handles the real attachment follow-up while keeping writes strict', () => {
  assert.equal(allowsPlainChatReply('不重新上传，前面文件的 Marker 是什么？只回复该标识，不操作日程。'), true);
  assert.equal(allowsPlainChatReply('请只读取附件中的 Marker 并原样回复该标识，不进行任何日程操作。'), true);
  for (const input of ['明天上午9点提醒我开会', '明天下午三点去医院', '改成十点', '换到周五', '还是取消', '删除那个', '不操作日程，但提醒我明天开会', 'Schedule a meeting tomorrow']) {
    assert.equal(allowsPlainChatReply(input), false, input);
  }
});

test('active drafts and item-specific conversations cannot fall back to prose', () => {
  assert.equal(allowsPlainChatReply('好的', { activePlan: true }), false);
  assert.equal(allowsPlainChatReply('只回复标识', { scoped: true }), false);
  assert.equal(allowsPlainChatReply('只回复标识'), true);
});

test('schedule clarification accepts natural confirmation and time/date corrections from recent user turns', () => {
  const activity = '周一早上8点半报表，周一中午去取卡，周一提醒同事上线小程序';
  assert.equal(requestsScheduleDraft(activity), false);
  assert.equal(requestsScheduleDraft('确认生成待确认的事项'), true);
  assert.equal(requestsScheduleDraft('这是下周一的任务啊', [activity]), true);
  assert.equal(requestsScheduleDraft('单独建一条新的，后三项时间按12点来', ['这是下周一的任务啊', activity]), true);
  assert.equal(requestsScheduleDraft('好的', [activity]), true);
  assert.equal(requestsScheduleDraft('好的'), false);
  assert.equal(requestsScheduleDraft('好的', ['讲个笑话', activity]), false);
  assert.equal(requestsScheduleDraft('好的', ['不用创建了', activity]), false);
  assert.deepEqual(scheduleDraftContext(['这是下周一的任务啊', activity, '上周看过的电影']), ['这是下周一的任务啊', activity]);
  assert.deepEqual(scheduleDraftContext(['讲个笑话', activity]), []);
  assert.deepEqual(scheduleDraftContext(['周一怎么学习编程？', activity]), []);
  assert.deepEqual(scheduleDraftContext(['明天有什么安排', activity]), []);
  for (const text of ['不用创建了', '先讨论一下', '为什么这么安排？', '明天有什么安排', '好的，讲个笑话']) {
    assert.equal(requestsScheduleDraft(text, [activity]), false, text);
  }
});
