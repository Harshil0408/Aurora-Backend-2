import type { NextFunction, Request, Response } from 'express';
import { logger } from '../../config/logger.js';

/**
 * Keys whose values must never appear in logs (passwords, tokens, TOTP
 * codes, secrets). Matched case-insensitively against the key name.
 */
const SENSITIVE_KEY_PATTERN = /password|secret|token|code|otp|authorization|cookie/i;

/** Upper bound on logged payload size — bodies can be up to 1mb. */
const MAX_LOGGED_CHARS = 2000;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redact(val);
    }
    return out;
  }
  return value;
}

/**
 * Redact + drop empties + truncate oversized payloads.
 * Returns undefined when there is nothing worth logging.
 */
function loggedPayload(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  const redacted = redact(value);
  if (typeof redacted === 'object' && redacted !== null && Object.keys(redacted).length === 0) {
    return undefined;
  }
  const serialized = JSON.stringify(redacted);
  if (serialized.length > MAX_LOGGED_CHARS) {
    return `${serialized.slice(0, MAX_LOGGED_CHARS)}…[truncated]`;
  }
  return redacted;
}

/**
 * Logs every completed request (method, path, status, duration, plus
 * query/params/body with sensitive values redacted).
 * Without this, successful requests are completely silent in the
 * terminal — only startup lines and unhandled 500s were visible.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const query = loggedPayload(req.query);
    const params = loggedPayload(req.params);
    const body = loggedPayload(req.body);
    logger.info('HTTP request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      // Spread conditionally so empty payloads don't print as `key: undefined`.
      ...(query !== undefined ? { query } : {}),
      ...(params !== undefined ? { params } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  });
  next();
}
