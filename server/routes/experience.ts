import {
  Router,
  type RequestHandler,
  type Request,
  type Response,
} from 'express';
import * as service from '../experience-service.js';
import {
  cancelExperienceRun,
  experienceModels,
  startExperienceRun,
} from '../experience-ai.js';
import { ExperienceError } from '../experience-contract.js';
export function createExperienceRouter({
  authenticate,
}: {
  authenticate: RequestHandler;
}) {
  const router = Router(),
    base = '/api/library/experience-sessions';
  const route = (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    handler: (userId: string, req: Request, res: Response) => unknown,
  ) => {
    router[method](path, authenticate, async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      try {
        const result = await handler((req as any).user.userId, req, res);
        if (!res.headersSent) res.json(result);
      } catch (error) {
        if (!res.headersSent)
          res
            .status(error instanceof ExperienceError ? error.status : 400)
            .json({
              error: {
                message:
                  error instanceof ExperienceError
                    ? error.message
                    : '操作失败，请重试；原有内容已保留',
              },
            });
      }
    });
  };
  route('get', base, (user) => ({ items: service.listSessions(user) }));
  route('get', base + '/models/:provider', async (user, req) => {
    if (!['chatgpt', 'workbuddy'].includes(req.params.provider))
      throw new ExperienceError('模型来源无效');
    return {
      models: await experienceModels(
        user,
        req.params.provider as 'chatgpt' | 'workbuddy',
      ),
    };
  });
  route('get', base + '/entry/:entryId', (user, req) => {
    const row = service.sessionForEntry(user, req.params.entryId);
    if (!row) throw new ExperienceError('经历不存在', 404);
    return service.sessionView(user, row.id);
  });
  route('get', base + '/images/:imageId', (user, req, res) => {
    const image = service.readImage(user, req.params.imageId);
    res.setHeader('Content-Type', image.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(image.bytes);
  });
  route('post', base, (user, req) =>
    service.createSession(user, req.body.requestId),
  );
  route('get', base + '/:id', (user, req) =>
    service.sessionView(user, req.params.id),
  );
  route('patch', base + '/:id', (user, req) =>
    service.saveDraft(user, req.params.id, req.body),
  );
  route('post', base + '/:id/run', (user, req) =>
    startExperienceRun(user, req.params.id, req.body),
  );
  route('post', base + '/:id/cancel', (user, req) =>
    cancelExperienceRun(user, req.params.id, req.body.expectedRevision),
  );
  route('post', base + '/:id/confirm', (user, req) =>
    service.confirmSession(user, req.params.id, req.body.expectedRevision),
  );
  route('post', base + '/:id/original', (user, req) =>
    service.organizeOriginal(
      user,
      req.params.id,
      req.body.expectedRevision,
      req.body.text,
    ),
  );
  route('post', base + '/:id/images', (user, req) =>
    service.uploadImage(user, req.params.id, req.body),
  );
  route('post', base + '/:id/lifecycle', (user, req) => {
    if (!['archive', 'restore', 'purge'].includes(req.body.action))
      throw new ExperienceError('操作无效');
    if (req.body.action === 'purge' && req.body.confirm !== true)
      throw new ExperienceError('永久删除需要确认');
    service.experienceLifecycle(
      user,
      req.params.id,
      req.body.expectedRevision,
      req.body.action,
    );
    return { success: true };
  });
  route('get', base + '/:id/export', (user, req, res) => {
    const bundle = service.exportExperience(user, req.params.id, true);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="experience-${req.params.id}.json"`,
    );
    return { format: 'orbit-experience-export', ...bundle };
  });
  return router;
}
