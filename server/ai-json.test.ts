import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAiMessageText, parseAiJson, parseAiJsonCandidates, parseAiChatCandidates } from './ai-json.js';

test('提取 Markdown 代码块中的 AI JSON', () => {
  const parsed = parseAiJson('```json\n{"intent":"query","operations":[]}\n```');
  assert.equal(parsed.value.intent, 'query');
  assert.equal(parsed.repaired, false);
});

test('修复字符串中未转义的双引号', () => {
  const parsed = parseAiJson('{"reply":"参加\"风险管理\"讲座","operations":[]}');
  assert.equal(parsed.value.reply, '参加"风险管理"讲座');
  assert.equal(parsed.repaired, true);
});

test('多个对象时只解析第一个完整对象', () => {
  const parsed = parseAiJson('{"intent":"chat"}\n调试信息 {"ignored":true}');
  assert.equal(parsed.value.intent, 'chat');
});

test('兼容 SDK assistant.content 为空而最终 JSON 位于 result.result', () => {
  const assistantText = extractAiMessageText({
    type: 'assistant',
    message: { content: [] },
  });
  const resultText = extractAiMessageText({
    type: 'result',
    subtype: 'success',
    result: '{"intent":"chat","reply":"已从知识库找到相关内容","operations":[]}',
  });

  assert.equal(assistantText, '');
  const parsed = parseAiJsonCandidates([assistantText, resultText]);
  assert.equal(parsed.value.intent, 'chat');
  assert.equal(parsed.value.reply, '已从知识库找到相关内容');
});

test('兼容 assistant content 直接为字符串和 structured_output', () => {
  assert.equal(
    extractAiMessageText({ type: 'assistant', message: { content: '{"intent":"chat"}' } }),
    '{"intent":"chat"}',
  );
  assert.equal(
    extractAiMessageText({ type: 'result', structured_output: { intent: 'chat', operations: [] } }),
    '{"intent":"chat","operations":[]}',
  );
});

test('ordinary chat accepts a plain attachment answer without creating action authority', () => {
  const parsed = parseAiChatCandidates(['ORBIT_ATTACHMENT_TEST_20261003'], true);
  assert.equal(parsed.textFallback, true);
  assert.equal(parsed.value.reply, 'ORBIT_ATTACHMENT_TEST_20261003');
  assert.equal(parsed.value.intent, 'chat');
  assert.deepEqual(parsed.value.operations, []);
  assert.deepEqual(parsed.value.knowledgeSourceIds, []);
  assert.equal(parseAiChatCandidates(['## Conclusion\n\n**Useful** detail.'], true).value.reply, '## Conclusion\n\n**Useful** detail.');
});

test('structured response retains precedence and operation drafts reject prose', () => {
  const structured = '{"intent":"create","reply":"待确认","operations":[{"type":"create","data":{"title":"Example"}}]}';
  const parsed = parseAiChatCandidates(['intermediate text', structured], true);
  assert.equal(parsed.textFallback, false);
  assert.equal(parsed.value.operations.length, 1);
  assert.throws(() => parseAiChatCandidates(['已安排明天9点会议'], false), /JSON/);
  assert.throws(() => parseAiJsonCandidates(['plain answer']), /JSON/);
});

test('empty or broken action envelopes are errors rather than successful plain chat', () => {
  for (const raw of ['', '   ', '{"reply":"unfinished', '[{"type":"create"', '```json\n{"operations":', 'Answer: "operations": [']) {
    assert.throws(() => parseAiChatCandidates([raw], true), /JSON/, raw);
  }
});
