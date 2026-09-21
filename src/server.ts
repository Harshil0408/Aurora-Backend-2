import 'dotenv/config';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { disconnectRedis } from './config/redis.js';

async function main(): Promise<void> {
  const env = getEnv();
  await connectDatabase();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`API listening on :${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down gracefully`);
    server.close(() => {
      void (async () => {
        await disconnectDatabase();
        await disconnectRedis();
        process.exit(0);
      })();
    });
    // Force-exit if graceful shutdown hangs
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

void main().catch((err: unknown) => {
  logger.error('Fatal startup error', { error: err });
  void disconnectDatabase().finally(() => process.exit(1));
});
