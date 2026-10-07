import { Router, type RequestHandler } from 'express';
import * as dailyReportCloudStore from '../daily-report-cloud-store.js';
import { getDailyReportDeliveryPolicy, normalizeDailyReportDeliverySources, setDailyReportDeliveryPolicy } from '../daily-report-delivery-policy.js';
import { addLog } from '../log-service.js';
import { contextInputWarnings } from '../../src/utils/daily-report-context.js';

export function createReportsPolicyRouter({ authenticate }: { authenticate: RequestHandler }) {
  const app = Router();
  app.get('/api/daily-report/cloud-context', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const context = dailyReportCloudStore.getDailyReportCloudContext((req as any).user.userId);
    res.json({ context, inputWarnings: context.readFailed ? ['已保存资料读取异常'] : contextInputWarnings(context.context) });
  });

  app.put('/api/daily-report/cloud-context', authenticate, (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => !['context', 'expectedVersion'].includes(key))) {
      return res.status(400).json({ error: '请求正文只允许包含 context、expectedVersion 字段' });
    }
    try {
      const context = dailyReportCloudStore.saveDailyReportCloudContext((req as any).user.userId, req.body.context, req.body.expectedVersion);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ context, inputWarnings: contextInputWarnings(context.context) });
    } catch (error: any) {
      if (error instanceof dailyReportCloudStore.DailyReportCloudContextConflict) return res.status(409).json({ error: error.message, code: error.code });
      if (error instanceof dailyReportCloudStore.DailyReportCloudInputError) return res.status(400).json({ error: error.message });
      res.status(500).json({ error: '保存资料失败，请稍后重试；当前草稿仍保留' });
    }
  });

  if (process.env.DIGEST_SHADOW_ONLY === 'true') app.patch('/api/daily-report/cloud-context/shadow-watchlist', authenticate, (req, res) => {
    const input = req.body;
    const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
    const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
    const text = (value: unknown, max: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
    if (!object(input) || !exactKeys(input, ['expectedVersion', 'stocks']) || !Number.isInteger(input.expectedVersion)
      || (input.expectedVersion as number) < 0 || !Array.isArray(input.stocks) || input.stocks.length !== 2
      || input.stocks.some((stock: unknown) => !object(stock) || !exactKeys(stock, ['name', 'symbol', 'priority', 'sectors', 'thesis'])
        || !text(stock.name, 200) || !text(stock.symbol, 40) || !/^[A-Za-z0-9.\-]+$/.test(stock.symbol as string)
        || !text(stock.priority, 40) || !Array.isArray(stock.sectors) || stock.sectors.length > 20
        || stock.sectors.some((sector: unknown) => !text(sector, 100)) || !object(stock.thesis)
        || !exactKeys(stock.thesis, ['status', 'priority', 'thesis', 'monitor'])
        || !text(stock.thesis.status, 100) || !text(stock.thesis.priority, 40)
        || !object(stock.thesis.thesis) || !object(stock.thesis.monitor))) {
      return res.status(400).json({ error: 'SHADOW_WATCHLIST_FIELDS_INVALID' });
    }
    const symbols = input.stocks.map((stock: { symbol: string }) => stock.symbol.toUpperCase());
    if (new Set(symbols).size !== 2) return res.status(400).json({ error: 'SHADOW_WATCHLIST_DUPLICATE' });
    const userId = (req as any).user.userId;
    const current = dailyReportCloudStore.getDailyReportCloudContext(userId);
    if (current.readFailed || current.version !== input.expectedVersion) return res.status(409).json({ error: 'SHADOW_WATCHLIST_VERSION_CONFLICT' });
    try {
      const existingWatchlist = object(current.context.watchlist) ? current.context.watchlist : {};
      const updated = dailyReportCloudStore.replaceDailyReportCloudContext(userId, {
        ...current.context, watchlist: { ...existingWatchlist, stocks: input.stocks },
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ version: updated.version, watchlistStockCount: input.stocks.length });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '保存隔离关注配置失败' });
    }
  });

  if (process.env.DIGEST_SHADOW_ONLY === 'true') app.delete('/api/daily-report/cloud-context/shadow-watchlist', authenticate, (req, res) => {
    const input = req.body;
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 1
      || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) return res.status(400).json({ error: 'SHADOW_WATCHLIST_FIELDS_INVALID' });
    const userId = (req as any).user.userId;
    const current = dailyReportCloudStore.getDailyReportCloudContext(userId);
    if (current.readFailed || current.version !== input.expectedVersion) return res.status(409).json({ error: 'SHADOW_WATCHLIST_VERSION_CONFLICT' });
    const context = { ...current.context };
    if (context.watchlist && typeof context.watchlist === 'object' && !Array.isArray(context.watchlist)) {
      const watchlist = { ...context.watchlist as Record<string, unknown> };
      delete watchlist.stocks;
      if (Object.keys(watchlist).length) context.watchlist = watchlist;
      else delete context.watchlist;
    }
    try {
      const updated = dailyReportCloudStore.replaceDailyReportCloudContext(userId, context);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ version: updated.version, watchlistStockCount: 0 });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '撤回隔离关注配置失败' });
    }
  });

  app.get('/api/daily-report/delivery-policy', authenticate, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(getDailyReportDeliveryPolicy((req as any).user.userId));
  });

  app.put('/api/daily-report/delivery-policy', authenticate, (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some(key => key !== 'sources')) {
      return res.status(400).json({ error: '请求正文只允许包含 sources 字段' });
    }
    try {
      const sources = normalizeDailyReportDeliverySources(req.body.sources);
      const userId = (req as any).user.userId;
      const policy = setDailyReportDeliveryPolicy(userId, sources);
      addLog('info', 'daily-report', '日报来源接收设置已保存', {
        event: 'daily_report_delivery_policy_saved',
        userId,
        sources: policy.sources,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json(policy);
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '保存日报来源接收设置失败' });
    }
  });

  app.get('/api/daily-report/cloud-activity', authenticate, (req, res) => {
    try {
      const activity = dailyReportCloudStore.listDailyReportCloudActivity((req as any).user.userId, {
        fromDate: req.query.fromDate ? String(req.query.fromDate) : undefined,
        toDate: req.query.toDate ? String(req.query.toDate) : undefined,
        limit: req.query.limit === undefined ? 100 : Number(req.query.limit),
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ activity });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '读取日报云端活动证据失败' });
    }
  });

  app.post('/api/daily-report/cloud-activity', authenticate, (req, res) => {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: '请求正文必须是对象' });
    }
    try {
      const activity = dailyReportCloudStore.createDailyReportCloudActivity((req as any).user.userId, req.body);
      res.status(201).setHeader('Cache-Control', 'no-store').json({ activity });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || '保存日报云端活动证据失败' });
    }
  });


  return app;
}
