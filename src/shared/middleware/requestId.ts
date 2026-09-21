import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

const HEADER = 'x-request-id';

export function requestId(req: Request, _res: Response, next: NextFunction): void {
  const incoming = req.header(HEADER);
  const id =
    typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
      ? incoming
      : randomUUID();
  req.id = id;
  next();
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation ID for this request (see requestId middleware). */
      id?: string;
    }
  }
}
