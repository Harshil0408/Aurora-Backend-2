import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/AppError.js';
import { logger } from '../../config/logger.js';

function toAppError(err: unknown, req: Request): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof z.ZodError) {
    return new AppError('BAD_REQUEST', 'Validation failed', z.treeifyError(err));
  }
  logger.error('Unhandled error', {
    requestId: req.id,
    method: req.method,
    path: req.path,
    error: err instanceof Error ? { message: err.message, stack: err.stack } : err,
  });
  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred');
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const appError = toAppError(err, req);
  res.status(appError.statusCode).json({
    success: false as const,
    error: {
      code: appError.code,
      message: appError.statusCode >= 500 ? 'An unexpected error occurred' : appError.message,
      ...(appError.details !== undefined && appError.statusCode < 500
        ? { details: appError.details }
        : {}),
      requestId: req.id,
    },
  });
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({
    success: false as const,
    error: { code: 'NOT_FOUND' as const, message: 'Route not found' },
  });
}
