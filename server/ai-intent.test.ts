import assert from 'node:assert/strict';
import test from 'node:test';
import { isReadOnlyScheduleQuery, needsScheduleContext, requestsKnowledgeContext, allowsPlainChatReply } from './ai-intent.js';

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
