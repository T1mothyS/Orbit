import express from 'express';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import type { ApiTiming } from './performance-alert-rules.js';
import { requestPhases, type RequestPhases } from './request-timing.js';
import { createApiRateLimiter, securityHeaders } from './http-security.js';
import { createProtectedToolsRouter } from './protected-tools.js';

export interface AppDependencies {
  isProduction: boolean;
  trustProxyHops?: number;
  isReady: () => boolean;
  oauthRouter?: express.RequestHandler;
  mcpRouter?: express.RequestHandler;
  media?: { route: string; root: string };
  staticPath?: string;
  protectedTools?: { root: string; authenticatePage: express.RequestHandler; isReady: () => boolean };
  registerRoutes?: (app: express.Express) => void;
  observeOperation?: (route: string, timing: ApiTiming, correlationId: string) => void;
}

// Importing this module does not load configuration, stores, workers or a listener.
export function createApp(deps: AppDependencies): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (Number.isInteger(deps.trustProxyHops) && deps.trustProxyHops! > 0) app.set('trust proxy', deps.trustProxyHops);
  app.use(securityHeaders(deps.isProduction));
  if (deps.observeOperation) app.use((req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();
    const started = performance.now();
    const phases: RequestPhases = {};
    const requestId = randomUUID();
    res.setHeader('X-Request-ID', requestId);
    res.once('finish', () => {
      if (typeof req.route?.path !== 'string') return;
      const authenticated = (req as express.Request & { user?: { userId: string } }).user;
      if (!authenticated) return;
      const route = req.method + ' ' + req.route.path;
      const supplied = req.get('X-Orbit-Operation-ID') ?? (route === 'POST /api/orbit/requests' ? req.body?.requestId : undefined);
      const operationId = typeof supplied === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(supplied)
        ? authenticated.userId + ':' + supplied : requestId;
      const timing = { operationId, durationMs: performance.now() - started, status: res.statusCode, observedAt: Date.now(), phases: { ...phases } };
      setImmediate(() => deps.observeOperation?.(route, timing, requestId));
    });
    requestPhases.run(phases, next);
  });
  app.use(createApiRateLimiter());
  const largeJsonParser = express.json({ limit: '75mb' });
  const chatAttachmentParser=express.json({limit:'15mb'});
  app.use((req, res, next) => {
    if(req.method==='POST'&&(/^\/api\/orbit\/conversations\/[^/]+\/attachments$/.test(req.path)||/^\/api\/library\/experience-sessions\/[^/]+\/images$/.test(req.path)||req.path==='/api/orbit/profile/avatar'||req.path==='/api/note-items/images'))return chatAttachmentParser(req,res,next);
    const acceptsLargeJson = req.method === 'POST' && (
      /^\/api\/completions\/[^/]+\/attachments$/.test(req.path)
      || req.path === '/api/ai/imports/parse'
    );
    if (acceptsLargeJson) return largeJsonParser(req, res, next);
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  if (deps.oauthRouter) app.use(deps.oauthRouter);
  if (deps.mcpRouter) app.use('/mcp', deps.mcpRouter);
  app.use('/api', (_req, res, next) => {
    if (!deps.isReady()) return res.status(503).json({ error: '数据库正在初始化，请稍后重试' });
    next();
  });
  if (deps.media) app.use(deps.media.route, express.static(deps.media.root, {
    dotfiles: 'deny', fallthrough: false, index: false, maxAge: '1y', immutable: true, redirect: false,
  }));
  if (deps.protectedTools) {
    // 必须位于主站静态资源和 SPA fallback 之前，避免工具路径被 index.html 接管。
    app.use('/tools', createProtectedToolsRouter(deps.protectedTools));
  }
  if (deps.isProduction && deps.staticPath) app.use(express.static(deps.staticPath));
  deps.registerRoutes?.(app);
  return app;
}

// Must be installed after every API router, including the remaining legacy routes.
export function registerSpaFallback(app: express.Express, staticPath: string): void {
  app.get('*', (_req, res) => res.sendFile(path.join(staticPath, 'index.html')));
}
