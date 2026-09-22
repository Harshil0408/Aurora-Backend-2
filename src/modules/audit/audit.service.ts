import { Prisma } from '../../generated/prisma/client.js';
import type { Prisma as PrismaTypes } from '../../generated/prisma/client.js';
import type { RequestMeta } from '../../shared/utils/requestMeta.js';

export interface AuditInput {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string;
  before?: unknown;
  after?: unknown;
  meta: RequestMeta;
}

/**
 * Persistent audit trail (MySQL) — distinct from Winston app logs:
 * structured, queryable, permission-gated, and written in the SAME
 * transaction as the business change it records. Never stores
 * passwords, tokens, or 2FA secrets — callers pass redacted snapshots.
 */
export async function recordAudit(
  db: PrismaTypes.TransactionClient,
  input: AuditInput,
): Promise<void> {
  await db.adminAuditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      before:
        input.before === undefined ? Prisma.DbNull : (input.before as PrismaTypes.InputJsonValue),
      after:
        input.after === undefined ? Prisma.DbNull : (input.after as PrismaTypes.InputJsonValue),
      ipAddress: input.meta.ipAddress ?? null,
      requestId: input.meta.requestId ?? null,
    },
  });
}
