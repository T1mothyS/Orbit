import { Router, type RequestHandler } from 'express';
import { querySystem, SystemQueryError, type SystemQueryKind } from '../system-query.js';
import { searchProductHelp } from '../product-help.js';
import { getUserById } from '../db.js';
import { listSystemEvents, systemEventRoleAllowed } from '../system-events.js';
import { performanceOverview, performanceRange, recordBrowserPerformance } from '../performance-metrics.js';
export function createSystemRouter({authenticate}:{authenticate:RequestHandler}) {
  const router = Router();
  const adminSystem: RequestHandler = (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!systemEventRoleAllowed((req as any).user.userId)) {
      res.status(403).json({ error: '仅管理员可访问性能记录' });
      return;
    }
    next();
  };
  router.get('/api/system/performance', authenticate, adminSystem, (req, res) => {
    const range = req.query.range ?? '1h';
    if (!performanceRange(range)) return res.status(400).json({ error: '时间范围不正确' });
    return res.json(performanceOverview(range));
  });
  router.post('/api/system/performance/browser', authenticate, adminSystem, (req, res) => {
    if (!recordBrowserPerformance(req.body)) return res.status(400).json({ error: '不接受该采样' });
    return res.sendStatus(204);
  });
  router.get('/api/system/events', authenticate, (req, res) => {
    const id = req.query.id;
    if (id !== undefined && (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) {
      return res.status(400).json({ error: '系统事件编号不正确' });
    }
    const events = listSystemEvents((req as any).user.userId, id);
    if (!events) return res.status(403).json({ error: '仅管理员可查询系统事件' });
    if (id && !events.length) return res.status(404).json({ error: '系统事件不存在' });
    return res.setHeader('Cache-Control', 'no-store').json({ events });
  });
  router.get('/api/orbit/product-help',authenticate,(req,res)=>{
    try { if (Object.keys(req.query).some(k=>k!=='q') || typeof req.query.q !== 'string') throw new SystemQueryError('请提供 q'); res.setHeader('Cache-Control','no-store').json(searchProductHelp(req.query.q,getUserById((req as any).user.userId)?.role==='admin')); }
    catch(e) { res.status(e instanceof SystemQueryError?e.status:400).json({error:'产品查询参数不正确'}); }
  });
  for (const kind of ['status','deployments','errors','tasks','daily-report-status','reminder-status'] as SystemQueryKind[]) router.get(`/api/system/${kind}`,authenticate,(req,res)=>{
    try {
      if (Object.keys(req.query).some(k=>!['date','source','id','limit'].includes(k)) || Object.values(req.query).some(v=>typeof v !== 'string')) throw new SystemQueryError('查询参数不正确');
      res.setHeader('Cache-Control','no-store').json(querySystem((req as any).user.userId,kind,{date:req.query.date as string|undefined,source:req.query.source as string|undefined,id:req.query.id as string|undefined,limit:req.query.limit===undefined?undefined:Number(req.query.limit)}));
    } catch(e) { res.status(e instanceof SystemQueryError?e.status:500).json({error:e instanceof SystemQueryError?e.message:'运行记录暂不可读取'}); }
  });
  return router;
}
