import type {
  Prisma,
  PrismaClient,
  LoginEventType as PrismaLoginEvent,
} from '../../../generated/prisma/client.js';
import type { RequestMeta } from '../../../shared/utils/requestMeta.js';

/** Security-event type = Prisma enum (single source, no drift). */
export type LoginEvent = PrismaLoginEvent;

interface LogLoginEventInput {
  adminId: string | null;
  event: LoginEvent;
  meta: RequestMeta;
}

/**
 * Security events go to MySQL (source of truth) — never only Redis/logs.
 * Passwords/tokens are never included; metadata only.
 */
export async function logLoginEvent(
  db: PrismaClient | Prisma.TransactionClient,
  input: LogLoginEventInput,
): Promise<void> {
  await db.adminLoginActivity.create({
    data: {
      adminId: input.adminId,
      event: input.event,
      outcome: input.event === 'LOGIN_SUCCESS' ? 'SUCCESS' : 'FAILURE',
      ipAddress: input.meta.ipAddress ?? null,
      userAgent: input.meta.userAgent ?? null,
      requestId: input.meta.requestId ?? null,
    },
  });
}
