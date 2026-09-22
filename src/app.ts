import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { getEnv } from './config/env.js';
import { errorHandler, notFound } from './shared/middleware/errorHandler.js';
import { requestId } from './shared/middleware/requestId.js';
import { healthRouter } from './modules/health/health.routes.js';
import { authRouter } from './modules/auth/routes/auth.routes.js';
import { adminRouter } from './modules/admin/routes/admin.routes.js';
import { docsRouter } from './docs/docs.routes.js';

export function createApp(): Express {
  const env = getEnv();
  const app = express();

  // Trust proxy: single hop (Docker / reverse proxy). Required for
  // correct req.ip behind a proxy; keep at 1 so X-Forwarded-For from
  // untrusted clients cannot be spoofed through multiple hops.
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      origin: env.FRONTEND_ORIGIN,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
    }),
  );

  app.use(`${env.API_PREFIX}/health`, healthRouter);
  app.use(`${env.API_PREFIX}/admin/auth`, authRouter);
  app.use(`${env.API_PREFIX}/admin`, adminRouter);
  app.use('/api/docs', docsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
