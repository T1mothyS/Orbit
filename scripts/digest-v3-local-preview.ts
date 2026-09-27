/** Fixed historical-source replay. Writes only to a fresh OS temporary directory. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordReviewedV3Source, renderLocalDigestV3Preview } from '../server/digest-v3-local-flow.js';

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-v3-local-preview-'));
process.env.DATA_DIR = outputDir;
const activity = await import('../server/activity-store.js');
await activity.initActivityDb();
const pairs = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'docs', 'daily-digest-v3-s2-01-cases.json'), 'utf8')).pairs;
const p01 = pairs.find((item: { id: string }) => item.id === 'P01');
if (!p01 || p01.sources.length !== 2) throw new Error('P01 固定来源缺失');
const userId = 'd07-local-fixture';
const cutoff = new Date().toISOString();
const source = (item: { url: string; fact: string; publishedAt: string; precision: string }, key: string) => ({
  url: item.url, publisherKey: 'nasa', documentType: 'mission_blog', language: 'en',
  sourceFact: item.fact, publishedAt: item.publishedAt, publishedPrecision: item.precision,
  independenceKey: key,
});
const base = { cutoff, eventId: 'artemis-i-flight' };
const first = recordReviewedV3Source(activity.digestV3Store, userId, {
  ...base, requestKey: 'P01-A',
  event: { eventType: 'mission', subjectKey: 'nasa:artemis-i', occurrenceKey: 'flight:artemis-i', title: 'Artemis I 任务进展' },
  source: source(p01.sources[0], 'P01-A'),
  fact: { factKey: 'mission_milestone', value: 'liftoff', unit: null, scope: 'artemis-i-flight' },
  analysis: { body: 'NASA 记录 Artemis I 已发射。此时溅落尚未发生，不能提前写作任务完成。' },
});
const before = renderLocalDigestV3Preview(activity.digestV3Store, userId, { ...first, cutoff: new Date().toISOString() });
const second = recordReviewedV3Source(activity.digestV3Store, userId, {
  ...base, requestKey: 'P01-B', expectedRevisionId: first.revisionId,
  source: source(p01.sources[1], 'P01-B'),
  fact: { factKey: 'mission_milestone', value: 'splashdown', unit: null, scope: 'artemis-i-flight' },
  analysis: { body: 'NASA 后续确认 Orion 已溅落；这是同一任务相对发射的新进展，应说明变化而非再报一次发射。' },
});
const after = renderLocalDigestV3Preview(activity.digestV3Store, userId, { ...second, cutoff: new Date().toISOString() });
fs.writeFileSync(path.join(outputDir, 'before.html'), before);
fs.writeFileSync(path.join(outputDir, 'after.html'), after);
console.log(JSON.stringify({ outputDir, before: path.join(outputDir, 'before.html'), after: path.join(outputDir, 'after.html'),
  eventId: second.eventId, revisionIds: [first.revisionId, second.revisionId],
  formalPublication: false, emailQueued: false }));
