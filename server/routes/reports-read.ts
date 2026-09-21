import { Router, type RequestHandler } from 'express';
import { getDailyReportCandidateView, getDailyReportView, getDailyReportViewsForDate, listDailyReportViewsPage } from '../daily-report-service.js';
import { isValidDateKey } from '../date-key.js';
import { getDigestArtifact, listDigestArtifacts } from '../activity-store.js';
import { digestArtifactView } from '../digest-v2-service.js';

export function createReportsReadRouter({ authenticate }: { authenticate: RequestHandler }) {
  const app = Router();
  app.get('/api/daily-report-v2/shadows', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const reports = listDigestArtifacts((req as any).user.userId, 'shadow').map(digestArtifactView).map(({ markdown, html, ...summary }) => summary);
    res.json({ reports });
  });
  app.get('/api/daily-reports', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const rawLimit = Number(req.query.limit || 100);
    const rawOffset = Number(req.query.offset || 0);
    const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
    const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
    if (req.query.view === 'shadow') {
      const all = listDigestArtifacts((req as any).user.userId, 'shadow');
      const reports = all.slice(offset, offset + limit).map(digestArtifactView).map(({ markdown, html, ...summary }) => summary);
      return res.json({ reports, total: all.length, offset, limit, view: 'shadow', hasMore: offset + reports.length < all.length });
    }
    const view = req.query.view === 'candidates' ? 'candidates' : 'received';
    const page = listDailyReportViewsPage((req as any).user.userId, limit, offset, view);
    res.json({ reports: page.reports, total: page.total, offset, limit, view, hasMore: offset + page.reports.length < page.total });
  });

  app.get('/api/daily-reports/:date', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const date = String(req.params.date || '');
    if (!isValidDateKey(date)) return res.status(400).json({ error: 'date 必须是有效的 YYYY-MM-DD 日期' });
    const userId = (req as any).user.userId;
    if (typeof req.query.shadow === 'string') {
      const row = getDigestArtifact(userId, req.query.shadow);
      if (!row || row.mode !== 'shadow' || row.report_date !== date) return res.status(404).json({ error: 'Shadow 日报不存在' });
      return res.json({ report: digestArtifactView(row), reports: [], view: 'shadow' });
    }
    const rawSource = req.query.source === undefined ? undefined : String(req.query.source);
    if (rawSource !== undefined && rawSource !== 'local' && rawSource !== 'cloud') {
      return res.status(400).json({ error: 'source 只能是 local 或 cloud' });
    }
    const rawView = req.query.view === undefined ? 'received' : String(req.query.view);
    if (rawView !== 'received' && rawView !== 'candidates') {
      return res.status(400).json({ error: 'view 只能是 received 或 candidates' });
    }
    const bundle = getDailyReportViewsForDate(userId, date);
    const candidateSource = bundle.reports.find(item => item.deliveryStatus === 'CANDIDATE')?.source;
    const report = rawSource === undefined
      ? rawView === 'received'
        ? bundle.report
        : candidateSource ? getDailyReportCandidateView(userId, date, candidateSource) : null
      : rawView === 'received'
        ? getDailyReportView(userId, date, rawSource)
        : getDailyReportCandidateView(userId, date, rawSource);
    if (!report) return res.status(404).json({ error: '该日期的日报不存在' });
    res.json({ report, reports: bundle.reports, view: rawView });
  });


  return app;
}
