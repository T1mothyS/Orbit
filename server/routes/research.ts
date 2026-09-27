import { Router, type RequestHandler } from 'express';
import { digestResearchStore, digestV3Store } from '../activity-store.js';
import { ResearchConflict } from '../digest-research-store.js';
import { publicDigestUrl } from '../digest-v2-contract.js';

function bodyObject(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(key => !fields.includes(key))) throw new Error('研究请求字段无效');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, name: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name}无效`);
  return value.trim();
}
function pageValue(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error('分页参数无效');
  return parsed;
}
function failure(res: import('express').Response, error: unknown): void {
  const status = error instanceof ResearchConflict ? 409 : 400;
  res.status(status).json({ error: error instanceof Error ? error.message : '研究操作失败' });
}

/** Login-only local Research/Thesis API. Work OAuth and automated polling are separate gates. */
export function createResearchRouter({ authenticate }: { authenticate: RequestHandler }) {
  const app = Router();

  app.get('/api/research/runs', authenticate, (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ runs: digestResearchStore.listRuns((req as any).user.userId,
        pageValue(req.query.limit, 50, 1, 100), pageValue(req.query.offset, 0, 0, 1_000_000)) });
    } catch (error) { failure(res, error); }
  });
  app.post('/api/research/runs', authenticate, (req, res) => {
    try {
      const body = bodyObject(req.body, ['candidateKey', 'subjectKey', 'subjectTitle', 'question', 'eventRevisionId']);
      const run = digestResearchStore.createRun((req as any).user.userId, {
        candidateKey: text(body.candidateKey, 120, '候选键'),
        subjectKey: text(body.subjectKey, 100, '研究对象键'),
        subjectTitle: text(body.subjectTitle, 200, '研究对象'),
        question: text(body.question, 1000, '研究问题'),
        eventRevisionId: body.eventRevisionId == null ? null : text(body.eventRevisionId, 120, '事件修订'),
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json({ run });
    } catch (error) { failure(res, error); }
  });
  app.get('/api/research/runs/:id', authenticate, (req, res) => {
    const userId = (req as any).user.userId;
    const run = digestResearchStore.getRun(userId, req.params.id);
    if (!run) return res.status(404).json({ error: '研究不存在或无权访问' });
    const revision = run.eventRevisionId ? digestV3Store.getRevision(userId, run.eventRevisionId) : null;
    const event = revision ? digestV3Store.getEvent(userId, revision.eventId) : null;
    const evidence = revision?.evidenceIds.flatMap(id => {
      const item = digestV3Store.getEvidence(userId, id);
      return item ? [{ id: item.id, url: publicDigestUrl(item.url) ? item.url : null, sourceFact: item.sourceFact,
        publisherKey: item.publisherKey, reviewState: item.reviewState, publishedAt: item.publishedAt }] : [];
    }) || [];
    res.setHeader('Cache-Control', 'no-store').json({ run,
      context: revision && event ? { eventTitle: event.title, revisionNo: revision.revisionNo, evidence } : null });
  });
  app.post('/api/research/runs/:id/claim', authenticate, (req, res) => {
    try {
      bodyObject(req.body, []);
      if (!digestResearchStore.getRun((req as any).user.userId, req.params.id)) return res.status(404).json({ error: '研究不存在或无权访问' });
      res.setHeader('Cache-Control', 'no-store').json(digestResearchStore.claimRun((req as any).user.userId, req.params.id));
    } catch (error) { failure(res, error); }
  });
  app.post('/api/research/runs/:id/complete', authenticate, (req, res) => {
    try {
      const body = bodyObject(req.body, ['leaseToken', 'resultBody', 'proposalBody']);
      if (!digestResearchStore.getRun((req as any).user.userId, req.params.id)) return res.status(404).json({ error: '研究不存在或无权访问' });
      const result = digestResearchStore.completeRun((req as any).user.userId, req.params.id,
        text(body.leaseToken, 128, '领取令牌'), text(body.resultBody, 8000, '研究结果'),
        body.proposalBody == null ? null : text(body.proposalBody, 3000, '观点提案'));
      res.setHeader('Cache-Control', 'no-store').json(result);
    } catch (error) { failure(res, error); }
  });
  app.post('/api/research/runs/:id/fail', authenticate, (req, res) => {
    try {
      const body = bodyObject(req.body, ['leaseToken']);
      if (!digestResearchStore.getRun((req as any).user.userId, req.params.id)) return res.status(404).json({ error: '研究不存在或无权访问' });
      res.setHeader('Cache-Control', 'no-store').json({ run: digestResearchStore.failRun((req as any).user.userId,
        req.params.id, text(body.leaseToken, 128, '领取令牌')) });
    } catch (error) { failure(res, error); }
  });
  app.get('/api/research/proposals', authenticate, (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ proposals: digestResearchStore.listProposals((req as any).user.userId,
        pageValue(req.query.limit, 50, 1, 100), pageValue(req.query.offset, 0, 0, 1_000_000)) });
    } catch (error) { failure(res, error); }
  });
  app.post('/api/research/proposals/:id/decision', authenticate, (req, res) => {
    try {
      const body = bodyObject(req.body, ['decision', 'expectedBaseVersionId', 'confirm']);
      if (!digestResearchStore.getProposal((req as any).user.userId, req.params.id)) return res.status(404).json({ error: '提案不存在或无权访问' });
      if (body.confirm !== true || (body.decision !== 'confirm' && body.decision !== 'reject') ||
        !(body.expectedBaseVersionId === null || typeof body.expectedBaseVersionId === 'string')) {
        throw new Error('请明确确认操作及观点基线');
      }
      const result = digestResearchStore.decideProposal((req as any).user.userId, req.params.id,
        body.decision, body.expectedBaseVersionId);
      res.setHeader('Cache-Control', 'no-store').json(result);
    } catch (error) { failure(res, error); }
  });
  app.get('/api/research/theses/:subjectKey', authenticate, (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ versions: digestResearchStore.listVersions((req as any).user.userId,
        text(req.params.subjectKey, 100, '研究对象键'), pageValue(req.query.limit, 50, 1, 100)) });
    } catch (error) { failure(res, error); }
  });
  return app;
}
