import type { Request } from 'express';

export interface RequestMeta {
  ipAddress: string | undefined;
  userAgent: string | undefined;
  requestId: string | undefined;
}

/**
 * Security-event metadata. req.ip is trustworthy only because
 * app.set('trust proxy', 1) — a single known proxy hop. Never read
 * X-Forwarded-For directly.
 */
export function getRequestMeta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip,
    userAgent: req.header('user-agent') ?? undefined,
    requestId: req.id,
  };
}
