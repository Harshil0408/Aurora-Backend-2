import { Router, type Request, type Response } from 'express';
import { getPrisma } from '../../config/db.js';
import { pingRedis } from '../../config/redis.js';
import { ok } from '../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../shared/utils/asyncHandler.js';

export const healthRouter: Router = Router();

healthRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json(ok({ status: 'ok', service: 'ecomm-backend', time: new Date().toISOString() }));
  }),
);

healthRouter.get(
  '/ready',
  asyncHandler(async (_req: Request, res: Response) => {
    let database = false;
    let redis = false;
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      database = true;
    } catch {
      database = false;
    }
    redis = await pingRedis();

    const ready = database; // Redis is optional (cache only)
    res.status(ready ? 200 : 503).json(
      ok({
        status: ready ? 'ready' : 'degraded',
        checks: {
          database: database ? 'up' : 'down',
          redis: redis ? 'up' : 'down',
        },
        time: new Date().toISOString(),
      }),
    );
  }),
);
