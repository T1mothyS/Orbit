import assert from 'node:assert/strict';
import test from 'node:test';
import { contextAt, contextFieldErrors, contextInputWarnings, createContextThesis, resolveContextThesis, stockContextDetail,
  updateContextField, type ContextObject } from '../src/utils/daily-report-context.js';
import { CloudContextRequestError, requestCloudContext } from '../src/services/daily-report-context.js';

const frame = () => ({ name: '合成标的', symbol: 'TEST', status: 'active', priority: 'high', thesis: { one_liner: '合成判断', extension: ['保留'] }, monitor: { earnings: ['合成指标'] } });
function fixture(): ContextObject {
  return { profile: { identity: { language: 'zh-CN', timezone: 'Asia/Shanghai' }, background: { education: ['合成背景'], career_context: '合成职业' }, extension: { keep: true } },
    preferences: { prefer: ['因果'], avoid: ['凑数'], target_reading_time_minutes: 10, evidence_policy: ['核对来源'] },
    recent_interests: { topics: [{ topic: '合成主题', priority: 'high', recency: '近期', keywords: ['测试'] }] },
    watchlist: { sectors: [{ name: '合成行业', priority: 'high', focus: ['公开证据'] }], stocks: [{ name: '合成标的', symbol: 'TEST', priority: 'high', sectors: [], thesis_file: 'theses/original.yaml', extension: { keep: 2 } }], companies: [] },
    theses: { original: frame() }, untouched: { array: [1, 2], flag: true } };
}
test('five groups edit only their field, retaining unknown fields and metadata', () => {
  const original = fixture(); let draft = original;
  for (const [path, value] of [
    [['profile', 'background', 'career_context'], '修改职业'], [['preferences', 'prefer'], ['更多证据']],
    [['recent_interests', 'topics', 0, 'keywords'], ['新关键词']], [['watchlist', 'sectors', 0, 'focus'], ['新角度']],
    [['theses', 'original', 'thesis', 'one_liner'], '修改判断'],
  ] as const) draft = updateContextField(draft, [...path], value);
  assert.equal(contextFieldErrors(draft).length, 0);
  assert.equal(contextAt(original, ['profile', 'background', 'career_context']), '合成职业');
  assert.deepEqual(draft.untouched, original.untouched);
  assert.deepEqual(contextAt(draft, ['profile', 'extension']), { keep: true });
  assert.deepEqual(contextAt(draft, ['watchlist', 'stocks', 0, 'extension']), { keep: 2 });
  assert.deepEqual(contextAt(draft, ['theses', 'original', 'thesis', 'extension']), ['保留']);
});
test('reference identity editing remains valid and shared references split without overwriting the other target', () => {
  const original = fixture();
  const updated = updateContextField(original, ['watchlist', 'stocks', 0, 'symbol'], 'NEW');
  const target = contextAt(updated, ['watchlist', 'stocks', 0]) as ContextObject;
  assert.equal(resolveContextThesis(updated, target)?.value.symbol, 'NEW');
  assert.equal(stockContextDetail(updated, target).issue, null);
  const shared = fixture(); (contextAt(shared, ['watchlist', 'companies']) as unknown[]).push(structuredClone(contextAt(shared, ['watchlist', 'stocks', 0])));
  const split = updateContextField(shared, ['watchlist', 'stocks', 0, 'symbol'], 'NEW');
  assert.equal(contextAt(split, ['theses', 'original', 'symbol']), 'TEST');
  assert.equal(resolveContextThesis(split, contextAt(split, ['watchlist', 'stocks', 0]) as ContextObject)?.value.symbol, 'NEW');
  assert.equal(resolveContextThesis(split, contextAt(split, ['watchlist', 'companies', 0]) as ContextObject)?.value.symbol, 'TEST');
});
test('legacy stock arrays and inline frameworks preserve shape; explicit creation does not invent a judgment', () => {
  const original: ContextObject = { watchlist: [{ name: '合成', symbol: 'TEST', priority: 'high', sectors: [], thesis: frame() }] };
  const updated = updateContextField(original, ['watchlist', 0, 'symbol'], 'NEW');
  assert.ok(Array.isArray(updated.watchlist));
  assert.equal(contextAt(updated, ['watchlist', 0, 'thesis', 'symbol']), 'NEW');
  const draft = createContextThesis({ watchlist: { stocks: [{ name: '合成', symbol: 'TEST', priority: 'medium', sectors: [] }] } }, ['watchlist', 'stocks', 0]);
  assert.deepEqual(contextAt(draft, ['theses', 'subject-1', 'thesis']), {});
  assert.equal(contextAt(draft, ['theses', 'subject-1', 'status']), 'draft');
  assert.match(contextInputWarnings(draft)[0], /研究内容尚未填写/);
});
test('reader warnings distinguish missing, broken references and oversized input without truncating context', () => {
  assert.match(contextInputWarnings({})[0], /尚未配置/);
  let context = fixture();
  context = updateContextField(context, ['theses', 'original', 'symbol'], 'OTHER');
  assert.match(contextInputWarnings(context)[0], /输入不完整/);
  context = fixture(); context = updateContextField(context, ['theses', 'original', 'thesis', 'one_liner'], '很长'.repeat(2500));
  assert.match(contextInputWarnings(context)[0], /长度限制/);
  assert.equal(stockContextDetail(context, contextAt(context, ['watchlist', 'stocks', 0]) as ContextObject).detail, '');
  assert.equal((contextAt(context, ['theses', 'original', 'thesis', 'one_liner']) as string).length, 5000);
});
test('known types and timezone are validated while extension fields survive', () => {
  assert.deepEqual(contextFieldErrors(fixture()), []);
  assert.match(contextFieldErrors({ preferences: { prefer: 'not-list' } })[0], /文字列表/);
  assert.match(contextFieldErrors({ preferences: { target_reading_time_minutes: 0 } })[0], /正整数/);
  assert.match(contextFieldErrors({ profile: { identity: { timezone: 'Not/AZone' } } })[0], /时区无效/);
  assert.deepEqual(contextFieldErrors({ preferences: { focus: ['legacy'] } }), []);
  assert.throws(() => updateContextField({}, ['__proto__', 'flag'], true), /无效字段/);
});
test('context client carries version and complete data; conflicts, broken reads and failures never return success', async () => {
  const context = fixture();
  let captured: RequestInit | undefined;
  const fetcher: typeof fetch = async (_, init) => { captured = init; return Response.json({ context: { version: 2, context, createdAt: null, updatedAt: null, readFailed: false } }); };
  const value = await requestCloudContext({ Authorization: 'Bearer synthetic' }, { context, expectedVersion: 1 }, fetcher);
  assert.equal(value.version, 2); assert.equal(captured?.method, 'PUT');
  assert.deepEqual(JSON.parse(String(captured?.body)), { context, expectedVersion: 1 });
  for (const [status, code] of [[409, 'CONTEXT_VERSION_CONFLICT'], [500, undefined]] as const) {
    await assert.rejects(requestCloudContext({}, { context, expectedVersion: 1 }, async () => Response.json({ error: '合成失败', code }, { status })),
      error => error instanceof CloudContextRequestError && error.status === status && error.code === code);
  }
  await assert.rejects(requestCloudContext({}, undefined, async () => Response.json({ context: { version: 1, context: {}, readFailed: true } })), /读取异常/);
  await assert.rejects(requestCloudContext({}, undefined, async () => new Response('<html>failure</html>', { status: 502 })), /服务暂时不可用/);
});
