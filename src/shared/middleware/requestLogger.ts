import type { NextFunction, Request, Response } from 'express';
import { logger } from '../../config/logger.js';

/**
 * Logs every completed request (method, path, status, duration).
 * Without this, successful requests are completely silent in the
 * terminal — only startup lines and unhandled 500s were visible.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    logger.info('HTTP request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
    });
  });
  next();
}
