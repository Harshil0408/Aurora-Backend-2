import type { Prisma, PrismaClient } from '../../../generated/prisma/client.js';
import type { RequestMeta } from '../../../shared/utils/requestMeta.js';

export async function recordStoreAudit(
  client: PrismaClient | Prisma.TransactionClient,
  input: {
    storeId: string;
    actorId?: string | null;
    actorEmail?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown> | null;
    meta?: RequestMeta | null;
  },
): Promise<void> {
  const db = client as PrismaClient;
  await db.storeAuditLog.create({
    data: {
      storeId: input.storeId,
      actorId: input.actorId ?? null,
      actorEmail: input.actorEmail ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      ...(input.metadata != null ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
      ipAddress: input.meta?.ipAddress ?? null,
      userAgent: input.meta?.userAgent ?? null,
      requestId: input.meta?.requestId ?? null,
    },
  });
}
