import assert from 'node:assert/strict';
import test from 'node:test';
import { DIGEST_V2_GENERATION, validateDigestV2, type DigestSnapshot, type DigestStory, type DigestV2 } from './digest-v2-contract.js';
import { decodeDigestPublication, digestV2Text, encodeDigestPublication, renderDigestV2 } from './digest-v2-render.js';

const cutoff = '2026-09-27T02:57:37.000Z';
const snapshot: DigestSnapshot = {
  date: '2026-09-27', timezone: 'Asia/Shanghai', cutoff, contextVersion: 1,
  calendar: { status: 'complete', items: [] }, mail: { status: 'complete', items: [] },
  watchlist: { status: 'complete', items: [] },
};
const story: DigestStory = { id: 's1', title: '同一条消息', summary: '已确认首项变化',
  evidence_ids: ['e1'], media_ids: [], verification: 'verified' };
function digest(): DigestV2 {
  return {
    schema_version: 'daily-digest.v2', date: snapshot.date, title: '今日情报简报', executive_signals: [],
    calendar: [], mail: [], market: [], macro: [], stories: [], watchlist: [], what_matters_next: [],
    evidence: [], media: [],
  };
}

test('D02 known publication after cutoff is rejected; unknown time remains explicit', () => {
  const d = digest(); d.stories = [story];
  d.evidence = [{ id: 'e1', url: 'https://example.com/news', source: 'Example', published_at: '2026-09-27T03:00:00Z' }];
  const late = validateDigestV2(d, snapshot);
  assert.equal(late.valid, false);
  assert.deepEqual(late.errors, [{ path: '$.evidence[0].published_at', code: 'EVIDENCE_AFTER_CUTOFF' }]);
  assert.equal(late.contentHash, null);
  d.evidence[0].published_at = cutoff;
  assert.equal(validateDigestV2(d, snapshot).valid, true);
  d.evidence[0].published_at = '';
  assert.equal(validateDigestV2(d, snapshot).valid, true);
});

test('D02 changed ID cannot republish identical text; distinct progress and shared source remain valid', () => {
  const d = digest(); d.market = [story];
  d.evidence = [{ id: 'e1', url: 'https://example.com/news', source: 'Example', published_at: '2026-09-26T12:00:00Z' }];
  d.stories = [{ ...story, id: 's2', summary: '**已确认**首项变化' }];
  assert.deepEqual(validateDigestV2(d, snapshot).errors,
    [{ path: '$.stories[0]', code: 'DUPLICATE_STORY_CONTENT' }]);
  d.stories[0].summary = '后续版本新增安全修复';
  assert.equal(validateDigestV2(d, snapshot).valid, true);
});

test('D02 zero news stays valid but requires a bounded selection review', () => {
  const empty = validateDigestV2(digest(), snapshot);
  assert.equal(empty.valid, true);
  assert.deepEqual(empty.reviewIssues, [{ path: '$.stories', code: 'NEWS_SELECTION_REVIEW_REQUIRED' }]);
  assert.deepEqual(empty.warnings, []);
  const d = digest(); d.stories = [story];
  d.evidence = [{ id: 'e1', url: 'https://example.com/news', source: 'Example', published_at: '' }];
  assert.deepEqual(validateDigestV2(d, snapshot).reviewIssues, []);
});

test('D02 frozen 2026-09-27.1 behavior and editorial rendering stay readable', () => {
  const d = digest(); d.stories = [story, { ...story, id: 's2' }];
  d.evidence = [{ id: 'e1', url: 'https://example.com/news', source: 'Example', published_at: '2026-09-27T03:00:00Z' }];
  const legacy = validateDigestV2(d, snapshot, '2026-09-27.1');
  assert.equal(legacy.valid, true);
  assert.deepEqual(legacy.reviewIssues, []);
  const publication = { digest: d, media: [], warnings: [], renderer: '2026-09-27.1' };
  assert.ok(decodeDigestPublication(encodeDigestPublication(publication)));
  assert.match(renderDigestV2(publication), /今日重点新闻/);
  assert.match(digestV2Text(publication), /发布时间/);
  const emphasis = digest(); emphasis.executive_signals = ['一段足够长但是完全没有标出重点的旧版正文内容。'];
  assert.ok(validateDigestV2(emphasis, snapshot, '2026-09-27.1').errors.some(issue => issue.code === 'EMPHASIS_REQUIRED'));
  assert.notEqual(DIGEST_V2_GENERATION, '2026-09-27.1');
});
