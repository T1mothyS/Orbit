import { Router, type RequestHandler, type Response } from 'express';
import { digestV3Store } from '../activity-store.js';
import { publicDigestUrl } from '../digest-v2-contract.js';
import { recordReviewedV3Source, renderLocalDigestV3Preview, validatedV3Cutoff, validatedV3Id } from '../digest-v3-local-flow.js';
import { DigestV3Conflict } from '../digest-v3-store.js';

function fields(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).some(key => !allowed.includes(key))) throw new Error('V3 接口字段无效');
  return value as Record<string, unknown>;
}

function page(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('V3 分页参数无效');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error('V3 分页参数无效');
  return parsed;
}

function fail(res: Response, error: unknown): void {
  if (error instanceof DigestV3Conflict) {
    res.status(409).json({ error: error.message });
  } else if (error instanceof Error && error.message.startsWith('V3 ')) {
    res.status(400).json({ error: error.message });
  } else {
    res.status(500).json({ error: 'V3 本地操作失败' });
  }
}

/** Login-only, manually reviewed local V3 API. No Work/OAuth publisher uses this router. */
export function createDigestV3Router({ authenticate }: { authenticate: RequestHandler }) {
  const app = Router();

  app.post('/api/digest-v3/reviewed-sources', authenticate, (req, res) => {
    try {
      const body = fields(req.body, ['confirmReviewed', 'submission']);
      if (body.confirmReviewed !== true) throw new Error('V3 需要明确确认已人工核对来源');
      const result = recordReviewedV3Source(digestV3Store, (req as any).user.userId, body.submission);
      res.setHeader('Cache-Control', 'no-store');
      res.status(result.status === 'created' ? 201 : 200).json(result);
    } catch (error) { fail(res, error); }
  });

  app.get('/api/digest-v3/events', authenticate, (req, res) => {
    try {
      fields(req.query, ['cutoff', 'limit', 'offset']);
      const cutoff = validatedV3Cutoff(req.query.cutoff);
      const result = digestV3Store.listEventsAtCutoff((req as any).user.userId, cutoff,
        page(req.query.limit, 50, 1, 100), page(req.query.offset, 0, 0, 1_000_000));
      res.setHeader('Cache-Control', 'no-store').json({ cutoff, ...result });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/digest-v3/events/:id/history', authenticate, (req, res) => {
    try {
      fields(req.query, ['cutoff', 'limit', 'offset']);
      const eventId = validatedV3Id(req.params.id);
      const cutoff = validatedV3Cutoff(req.query.cutoff);
      const history = digestV3Store.getEventHistory((req as any).user.userId, eventId, cutoff,
        page(req.query.limit, 50, 1, 100), page(req.query.offset, 0, 0, 1_000_000));
      if (!history) return res.status(404).json({ error: '事件不存在或截点前不可见' });
      res.setHeader('Cache-Control', 'no-store').json({ cutoff, ...history,
        history: history.history.map(item => ({ ...item, evidence: item.evidence.map(source => ({
          ...source, url: publicDigestUrl(source.url) ? source.url : null,
        })) })),
      });
    } catch (error) { fail(res, error); }
  });

  app.get('/api/digest-v3/events/:id/preview', authenticate, (req, res) => {
    try {
      fields(req.query, ['revisionId', 'analysisId', 'cutoff']);
      const html = renderLocalDigestV3Preview(digestV3Store, (req as any).user.userId, {
        eventId: validatedV3Id(req.params.id), revisionId: validatedV3Id(req.query.revisionId),
        analysisId: validatedV3Id(req.query.analysisId), cutoff: validatedV3Cutoff(req.query.cutoff),
      });
      res.setHeader('Cache-Control', 'no-store').type('html').send(html);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('V3 预览')) {
        res.status(404).json({ error: error.message });
      } else { fail(res, error); }
    }
  });

  return app;
}
