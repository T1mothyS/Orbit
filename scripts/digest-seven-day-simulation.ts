/** Seven synthetic report dates in one isolated local run. Never reads real account inputs. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestHash, type CheckStatus, type DigestSnapshot, type DigestV2 } from '../server/digest-v2-contract.js';

const seed = 20260927;
const userId = 'seven-day-simulation';
const outputRoot = path.resolve('dist-shadow');
type Section = 'market' | 'macro' | 'stories';
type Candidate = {
  id: string; sourceId: string; eventKey: string; section: Section; title: string; summary: string;
  publishedDay: number; publishedHour?: number; relation: string; selected: boolean; reason: string;
};
type PlannedDay = { day: number; date: string; cutoff: string; snapshot: DigestSnapshot; candidates: Candidate[] };

const candidateDays: Candidate[][] = [
  [
    { id: 'a-initial', sourceId: 'a-initial', eventKey: 'A', section: 'market', title: '模拟事件A', summary: '**模拟事件A**首次公告。', publishedDay: 1, relation: 'new', selected: true, reason: '首次可核对的变化' },
    { id: 'b-initial', sourceId: 'b-initial', eventKey: 'B', section: 'macro', title: '模拟事件B', summary: '**模拟事件B**首次公告。', publishedDay: 1, relation: 'new', selected: true, reason: '独立新事件' },
  ],
  [
    { id: 'a-repeat-1', sourceId: 'a-initial', eventKey: 'A', section: 'market', title: '模拟事件A', summary: '**模拟事件A**首次公告。', publishedDay: 1, relation: 'cross-day-repeat', selected: false, reason: '前一期已经报道' },
    { id: 'a-repeat-2', sourceId: 'a-copy', eventKey: 'A', section: 'stories', title: '模拟事件A', summary: '模拟事件A首次公告。', publishedDay: 1, relation: 'same-day-copy', selected: false, reason: '同日换 ID 完全同文' },
    { id: 'c-initial', sourceId: 'c-initial', eventKey: 'C', section: 'stories', title: '模拟事件C', summary: '**模拟事件C**首次公告。', publishedDay: 2, relation: 'new', selected: true, reason: '独立新事件' },
  ],
  [
    { id: 'a-old', sourceId: 'a-initial', eventKey: 'A', section: 'market', title: '模拟事件A', summary: '**模拟事件A**首次公告。', publishedDay: 1, relation: 'cross-day-repeat', selected: false, reason: '旧事实没有新增价值' },
    { id: 'a-progress', sourceId: 'a-progress', eventKey: 'A', section: 'market', title: '模拟事件A', summary: '**模拟事件A**出现进展。', publishedDay: 3, relation: 'progress', selected: true, reason: '同事件出现实质新进展' },
  ],
  [
    { id: 'a-stale', sourceId: 'a-initial', eventKey: 'A', section: 'market', title: '模拟事件A', summary: '**模拟事件A**首次公告。', publishedDay: 1, relation: 'cross-day-repeat', selected: false, reason: '旧事实重复' },
    { id: 'b-stale', sourceId: 'b-initial', eventKey: 'B', section: 'macro', title: '模拟事件B', summary: '**模拟事件B**首次公告。', publishedDay: 1, relation: 'cross-day-repeat', selected: false, reason: '旧事实重复；当天没有合格新增' },
  ],
  [
    { id: 'b-reprint', sourceId: 'b-reprint', eventKey: 'B', section: 'macro', title: '模拟事件B再述', summary: '**模拟事件B**内容改写。', publishedDay: 5, relation: 'paraphrased-reprint', selected: false, reason: '同一事实的改写转载' },
    { id: 'd-initial', sourceId: 'd-initial', eventKey: 'D', section: 'stories', title: '模拟事件D', summary: '**模拟事件D**首次公告。', publishedDay: 5, relation: 'new', selected: true, reason: '独立新事件' },
  ],
  [
    { id: 'e-too-late', sourceId: 'e-source', eventKey: 'E', section: 'stories', title: '模拟事件E', summary: '**模拟事件E**首次公告。', publishedDay: 6, publishedHour: 13, relation: 'after-cutoff', selected: false, reason: '13:00 发表，晚于 12:00 截点' },
    { id: 'f-distinct', sourceId: 'f-initial', eventKey: 'F', section: 'market', title: '模拟事件A的另一项目', summary: '**另一项目**首次公告。', publishedDay: 6, relation: 'similar-title-distinct', selected: true, reason: '标题相似但对象不同' },
  ],
  [
    { id: 'e-eligible', sourceId: 'e-source', eventKey: 'E', section: 'stories', title: '模拟事件E', summary: '**模拟事件E**首次公告。', publishedDay: 6, publishedHour: 13, relation: 'new-after-cutoff', selected: true, reason: '到本期截点已可使用' },
    { id: 'c-repeat', sourceId: 'c-initial', eventKey: 'C', section: 'stories', title: '模拟事件C', summary: '**模拟事件C**首次公告。', publishedDay: 2, relation: 'cross-day-repeat', selected: false, reason: '前一期已报道且无新变化' },
  ],
];

function random(seedValue: number): () => number {
  let state = seedValue >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function dateOf(day: number): string { return `2020-01-${String(day).padStart(2, '0')}`; }
function cutoffOf(day: number): string { return `${dateOf(day)}T12:00:00.000Z`; }
function publishedAt(candidate: Candidate): string {
  return `${dateOf(candidate.publishedDay)}T${String(candidate.publishedHour ?? 9).padStart(2, '0')}:00:00.000Z`;
}
function sourceUrl(candidate: Candidate): string { return `https://example.com/simulation/${candidate.sourceId}`; }
function makePlan(): PlannedDay[] {
  const next = random(seed);
  return candidateDays.map((fixtures, index) => {
    const day = index + 1;
    const section = (name: 'calendar' | 'mail' | 'watchlist', status: CheckStatus, count: number) => ({
      status, items: Array.from({ length: count }, (_, i) => ({
        id: `${name}-D${day}-${i}`, title: `模拟${name}${i + 1}`, detail: `seed-${seed}-D${day}`,
      })),
    });
    const snapshot: DigestSnapshot = {
      date: dateOf(day), timezone: 'Asia/Shanghai', cutoff: cutoffOf(day), contextVersion: 1,
      calendar: section('calendar', 'complete', day === 1 ? 1 + Math.floor(next() * 2) : Math.floor(next() * 3)),
      mail: section('mail', day === 4 ? 'failed' : day === 5 ? 'not_configured' : day === 6 ? 'partial' : 'complete',
        day === 4 || day === 5 ? 0 : day === 6 ? 1 + Math.floor(next() * 2) : Math.floor(next() * 3)),
      watchlist: section('watchlist', day === 6 ? 'partial' : 'complete', Math.floor(next() * 3)),
    };
    const candidates = fixtures.map(item => ({ ...item }));
    if (day !== 4) {
      const extras = 1 + Math.floor(next() * 2);
      for (let i = 0; i < extras; i++) {
        const id = `random-D${day}-${i}`;
        candidates.push({ id, sourceId: id, eventKey: id, section: (['market', 'macro', 'stories'] as const)[Math.floor(next() * 3)],
          title: `模拟随机事件D${day}-${i}`, summary: '**模拟候选**出现新变化。', publishedDay: day,
          relation: 'seeded-new', selected: true, reason: '固定种子生成的独立合成事件' });
      }
    }
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    return { day, date: snapshot.date, cutoff: snapshot.cutoff, snapshot, candidates };
  });
}
function makeDigest(day: PlannedDay, selected: Candidate[]): DigestV2 {
  const digest: DigestV2 = {
    schema_version: 'daily-digest.v2', date: day.date, title: `七日合成回放 · D${day.day}`,
    executive_signals: [],
    calendar: day.snapshot.calendar.items.map(item => ({ input_id: item.id, text: `模拟日程 ${item.id}` })),
    mail: day.snapshot.mail.items.map(item => ({ input_id: item.id, summary: `模拟邮件 ${item.id}`, action: '待人工核对' })),
    market: [], macro: [], stories: [],
    watchlist: day.snapshot.watchlist.items.map(item => ({ input_id: item.id, summary: '模拟关注项待核对', check: 'incomplete', change: 'unknown', evidence_ids: [] })),
    what_matters_next: [], evidence: [], media: [],
  };
  for (const item of selected) {
    const evidenceId = `e-${item.id}`;
    digest.evidence.push({ id: evidenceId, url: sourceUrl(item), source: '模拟来源（非真实新闻）', published_at: publishedAt(item) });
    digest[item.section].push({ id: item.id, title: item.title, summary: item.summary,
      evidence_ids: [evidenceId], media_ids: [], verification: 'unverified' });
  }
  return digest;
}
function v3Input(candidate: Candidate, cutoff: string, previousRevisionId?: string) {
  return {
    requestKey: candidate.id, cutoff, eventId: 'sim-event-a',
    ...(previousRevisionId ? { expectedRevisionId: previousRevisionId } : {
      event: { eventType: 'simulation', subjectKey: 'sim:a', occurrenceKey: 'sim:a:2020', title: '模拟事件A' },
    }),
    source: { url: sourceUrl(candidate), publisherKey: 'simulated', documentType: 'simulation', language: 'zh',
      sourceFact: candidate.summary, publishedAt: publishedAt(candidate), publishedPrecision: 'second',
      independenceKey: candidate.sourceId },
    fact: { factKey: 'state', value: previousRevisionId ? 'progress' : 'initial', unit: null, scope: 'sim-event-a' },
    analysis: { body: previousRevisionId ? '模拟事件A出现新进展；此前公告仍保留。' : '模拟事件A首次公告，后续进展尚未发生。' },
  };
}

async function verifyFreshProcess(outputDir: string): Promise<void> {
  const resolved = path.resolve(outputDir);
  if (!resolved.startsWith(path.join(outputRoot, 'seven-day-')) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('SIMULATION_OUTPUT_PATH_INVALID');
  }
  process.env.DATA_DIR = resolved;
  const activity = await import('../server/activity-store.js');
  await activity.initActivityDb();
  const report = JSON.parse(fs.readFileSync(path.join(resolved, 'result.json'), 'utf8'));
  const saved = activity.exportUserActivity(userId);
  assert.equal(saved.digestV2Runs.length, 7);
  assert.equal(saved.digestV2Artifacts.length, 7);
  assert.equal(saved.digestV3Events.length, 1);
  assert.equal(saved.digestV3Revisions.length, 2);
  assert.equal(saved.dailyReports.length, 0);
  assert.equal(saved.notifications.length, 0);
  for (const day of report.days) {
    const artifact = activity.getDigestArtifact(userId, day.shadow.artifactId);
    assert.equal(artifact?.content_hash, day.shadow.contentHash);
    assert.equal(artifact?.mode, 'shadow');
  }
}

async function run(): Promise<void> {
  const plan = makePlan();
  assert.deepEqual(plan, makePlan(), 'fixed seed must reproduce all generated inputs and candidate order');
  fs.mkdirSync(outputRoot, { recursive: true });
  const outputDir = fs.mkdtempSync(path.join(outputRoot, 'seven-day-'));
  process.env.DATA_DIR = outputDir;
  process.env.APP_ENV = 'development';
  process.env.NODE_ENV = 'test';
  process.env.BACKGROUND_JOBS_ENABLED = 'false';
  process.env.DIGEST_V2_ENABLED = 'true';
  process.env.DIGEST_SHADOW_ONLY = 'true';
  const activity = await import('../server/activity-store.js');
  const service = await import('../server/digest-v2-service.js');
  const v3 = await import('../server/digest-v3-local-flow.js');
  await activity.initActivityDb();
  const scenarioHash = digestHash(plan);
  const days: Array<Record<string, any>> = [];
  let initial: ReturnType<typeof v3.recordReviewedV3Source> | null = null;
  let progress: ReturnType<typeof v3.recordReviewedV3Source> | null = null;
  let initialInput: ReturnType<typeof v3Input> | null = null;
  let initialHtml = '';
  let progressHtml = '';
  let progressInput: ReturnType<typeof v3Input> | null = null;
  let lastRunId = '';
  let lastDigest: DigestV2 | null = null;
  let lastArtifactId = '';
  for (const day of plan) {
    const run = service.createDigestSnapshotRun(userId, day.snapshot);
    const raw = makeDigest(day, day.candidates);
    const beforeDryRun = activity.exportActivityDb();
    const rawResult = await service.publishDigestV2(userId, run.runId, raw, 'dry_run');
    assert.deepEqual(activity.exportActivityDb(), beforeDryRun, 'dry_run changed the isolated database');
    const rawCodes = (rawResult.errors as Array<{ code: string }> | undefined)?.map(item => item.code) ?? [];
    if (day.day === 2) assert.ok(rawCodes.includes('DUPLICATE_STORY_CONTENT'));
    if (day.day === 6) assert.ok(rawCodes.includes('EVIDENCE_AFTER_CUTOFF'));
    if ([1, 3, 4, 5, 7].includes(day.day)) assert.equal(rawResult.valid, true);
    const reviewed = makeDigest(day, day.candidates.filter(item => item.selected));
    const reviewValidation = service.validateDigestRun(userId, run.runId, reviewed);
    assert.equal(reviewValidation.valid, true, `D${day.day} reviewed digest invalid: ${JSON.stringify(reviewValidation.errors)}`);
    if (day.day === 4) assert.deepEqual(reviewValidation.reviewIssues,
      [{ path: '$.stories', code: 'NEWS_SELECTION_REVIEW_REQUIRED' }]);
    const published = await service.publishDigestV2(userId, run.runId, reviewed, 'shadow', {
      storage: null, rules: [], mediaRoot: path.join(outputDir, 'media'),
    });
    assert.equal(published.status, 'SHADOW_SAVED');
    assert.equal(published.emailStatus, 'NOT_QUEUED');
    assert.equal(published.contentHash, reviewValidation.contentHash);
    const artifactId = String(published.artifactId);
    const artifact = activity.getDigestArtifact(userId, artifactId);
    assert.ok(artifact);
    assert.equal(activity.getDigestArtifact('other-simulated-user', artifactId), null);
    const view = service.digestArtifactView(artifact);
    assert.ok(String(view.html).includes(day.date));
    const previewFile = `D${day.day}.html`;
    const preview = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>合成回放 D${day.day}</title><body style="font-family:system-ui,sans-serif"><p style="max-width:680px;margin:20px auto;padding:12px;background:#fff3cd;color:#472f00">仅合成数据 · D${day.day} · 非真实日报或新闻</p>${view.html}</body></html>`;
    fs.writeFileSync(path.join(outputDir, previewFile), preview, 'utf8');
    if (day.day === 1 || day.day === 3) {
      const candidate = day.candidates.find(item => item.id === (day.day === 1 ? 'a-initial' : 'a-progress'))!;
      const input = v3Input(candidate, day.cutoff, initial?.revisionId);
      const refs = v3.recordReviewedV3Source(activity.digestV3Store, userId, input, () => new Date(day.cutoff));
      const html = v3.renderLocalDigestV3Preview(activity.digestV3Store, userId, { ...refs, cutoff: day.cutoff });
      fs.writeFileSync(path.join(outputDir, `D${day.day}-event.html`), html, 'utf8');
      if (day.day === 1) { initial = refs; initialInput = input; initialHtml = html; }
      else { progress = refs; progressInput = input; progressHtml = html; assert.match(html, /上次记录/); assert.match(html, /progress/); }
    }
    days.push({
      day: day.day, date: day.date, cutoff: day.cutoff,
      input: Object.fromEntries((['calendar', 'mail', 'watchlist'] as const).map(section =>
        [section, { status: day.snapshot[section].status, count: day.snapshot[section].items.length }])),
      candidates: day.candidates.map(item => ({ id: item.id, eventKey: item.eventKey, relation: item.relation,
        sourceUrl: sourceUrl(item), publishedAt: publishedAt(item), selectedByHumanOracle: item.selected, reason: item.reason })),
      raw: { valid: rawResult.valid, codes: rawCodes, reviewIssues: rawResult.reviewIssues,
        automaticSemanticDecision: 'NOT_IMPLEMENTED' },
      reviewed: { valid: reviewValidation.valid, selectedCount: reviewed.market.length + reviewed.macro.length + reviewed.stories.length,
        reviewIssues: reviewValidation.reviewIssues },
      shadow: { artifactId, contentHash: published.contentHash, emailStatus: published.emailStatus, previewFile },
    });
    if (day.day === 7) { lastRunId = run.runId; lastDigest = reviewed; lastArtifactId = artifactId; }
  }
  assert.ok(initial && progress && initialInput && progressInput && lastDigest);
  assert.equal(v3.recordReviewedV3Source(activity.digestV3Store, userId, initialInput,
    () => new Date(cutoffOf(7))).status, 'existing');
  assert.equal(v3.recordReviewedV3Source(activity.digestV3Store, userId, progressInput,
    () => new Date(cutoffOf(7))).status, 'existing');
  assert.equal(v3.renderLocalDigestV3Preview(activity.digestV3Store, userId,
    { ...initial, cutoff: cutoffOf(1) }), initialHtml);
  assert.throws(() => v3.renderLocalDigestV3Preview(activity.digestV3Store, 'other-simulated-user',
    { ...initial, cutoff: cutoffOf(7) }), /引用无效/);
  const backup = activity.exportUserActivity(userId);
  assert.equal(backup.digestV2Runs.length, 7);
  assert.equal(backup.digestV2Artifacts.length, 7);
  assert.equal(backup.dailyReports.length, 0);
  assert.equal(backup.notifications.length, 0);
  activity.restoreUserActivity(userId, backup, 'replace');
  assert.equal(v3.renderLocalDigestV3Preview(activity.digestV3Store, userId,
    { ...initial, cutoff: cutoffOf(1) }), initialHtml);
  assert.equal(v3.renderLocalDigestV3Preview(activity.digestV3Store, userId,
    { ...progress, cutoff: cutoffOf(3) }), progressHtml);
  const retried = await service.publishDigestV2(userId, lastRunId, lastDigest, 'shadow', {
    storage: null, rules: [], mediaRoot: path.join(outputDir, 'media'),
  });
  assert.equal(retried.artifactId, lastArtifactId);
  assert.equal(activity.exportUserActivity(userId).digestV2Artifacts.length, 7);
  const report = {
    status: 'LOCAL_SYNTHETIC_REPLAY', seed, scenarioHash, outputDir, syntheticDates: plan.map(day => day.date),
    days, checks: {
      sevenShadowArtifacts: true, sameDayExactDuplicateRejected: true, lateSourceRejected: true,
      emptyNewsReviewPrompt: true, manualProgressAndFrozenPreview: true,
      accountRestoreAndIdempotentRetry: true, crossDaySemanticDedup: 'NOT_IMPLEMENTED',
      noFormalReportsOrNotifications: true, externalMediaLifecycle: 'NOT_TESTED', realWorkRuns: 'NOT_TESTED',
    },
  };
  fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(report, null, 2), 'utf8');
  const rows = days.map(day => `| D${day.day} | ${day.candidates.length} | ${day.raw.valid ? '通过（不代表选题正确）' : day.raw.codes.join(', ')} | ${day.reviewed.selectedCount} | ${day.reviewed.reviewIssues.map((item: { code: string }) => item.code).join(', ') || '无'} |`).join('\n');
  const markdown = `# 七日压缩模拟结果（合成数据）\n\n固定种子：\`${seed}\`；七个日期全部为模拟，不是七次真实 Work 运行。原始候选直接形成的草稿与人工标准答案复核后的 Shadow 分开统计。\n\n| 日期 | 候选 | 原始草稿校验 | 人工复核后入选 | 复核提示 |\n| --- | ---: | --- | ---: | --- |\n${rows}\n\n- 七期 Shadow、输入覆盖、账号隔离、幂等重试、账号恢复及新进程读回：通过。\n- 同期完全同文与截点后已知来源：如预期被拒。D4 空新闻合法并提示审阅。\n- 跨日期重复、改写转载和相似标题的自动事件判断：**未实现**；本次排除决定来自合成样本的人工标准答案。\n- D1→D3 的 V3 Event/Revision/Analysis 是人工指定关系的本地预览，旧版引用保持不变。\n- 未连接真实新闻检索、Work、邮箱、外部图片或 R2；没有正式日报、通知或发信。七日 Bucket 自动到期无法通过本地调时钟验证。\n\n逐条候选及排除理由见 \`result.json\`，预览见 \`D1.html\` 至 \`D7.html\`、\`D1-event.html\` 与 \`D3-event.html\`。\n`;
  fs.writeFileSync(path.join(outputDir, 'report.md'), markdown, 'utf8');
  execFileSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--verify', outputDir],
    { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(JSON.stringify({ outputDir, report: path.join(outputDir, 'report.md'), result: path.join(outputDir, 'result.json'),
    scenarioHash, sevenShadowArtifacts: 7, restartVerification: 'PASS', crossDaySemanticDedup: 'NOT_IMPLEMENTED',
    formalReports: 0, notifications: 0 }));
}

if (process.argv[2] === '--verify') await verifyFreshProcess(process.argv[3]);
else if (process.argv.length === 2) await run();
else throw new Error('UNKNOWN_SIMULATION_ARGUMENT');
