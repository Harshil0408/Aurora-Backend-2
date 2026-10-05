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
 * Persistent audit trail (Postgres) — distinct from Winston app logs:
 * structured, queryable, permission-gated, and written in the SAME
 * transaction as the business change it records. Never stores
 * passwords, tokens, or 2FA secrets — callers pass redacted snapshots.
 *
 * Actor/resource display snapshots are resolved here (inside the writing
 * transaction) so history rows survive later renames/deletes — readers
 * never JOIN for names. Snapshot resolution is best-effort: it must never
 * break the business transaction it rides along with.
 */
export async function recordAudit(
  db: PrismaTypes.TransactionClient,
  input: AuditInput,
): Promise<void> {
  let snapshots: {
    actorEmail: string | null;
    actorName: string | null;
    resourceLabel: string | null;
  } = {
    actorEmail: null,
    actorName: null,
    resourceLabel: null,
  };
  try {
    snapshots = await resolveSnapshots(db, input);
  } catch {
    // Best-effort only — the audit row is still written below.
  }
  await db.adminAuditLog.create({
    data: {
      actorId: input.actorId,
      actorEmail: snapshots.actorEmail,
      actorName: snapshots.actorName,
      resourceLabel: snapshots.resourceLabel,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      before:
        input.before === undefined ? Prisma.DbNull : (input.before as PrismaTypes.InputJsonValue),
      after:
        input.after === undefined ? Prisma.DbNull : (input.after as PrismaTypes.InputJsonValue),
      ipAddress: input.meta.ipAddress ?? null,
      userAgent: input.meta.userAgent ?? null,
      requestId: input.meta.requestId ?? null,
    },
  });
}

async function resolveSnapshots(
  db: PrismaTypes.TransactionClient,
  input: AuditInput,
): Promise<{ actorEmail: string | null; actorName: string | null; resourceLabel: string | null }> {
  let actorEmail: string | null = null;
  let actorName: string | null = null;
  if (input.actorId) {
    const actor = await db.adminUser.findUnique({
      where: { id: input.actorId },
      select: { email: true, name: true },
    });
    if (actor) {
      actorEmail = actor.email;
      actorName = actor.name;
    }
  }
  let resourceLabel: string | null = null;
  if (input.resourceId) {
    if (input.resourceType === 'admin') {
      const target = await db.adminUser.findUnique({
        where: { id: input.resourceId },
        select: { email: true },
      });
      resourceLabel = target?.email ?? input.resourceId;
    } else if (input.resourceType === 'role') {
      // Role audit rows are keyed by role key (keys are permanent).
      const role = await db.adminRole.findUnique({
        where: { key: input.resourceId },
        select: { name: true },
      });
      resourceLabel = role?.name ?? input.resourceId;
    } else if (input.resourceType === 'permission') {
      // Permission rows carry the module.action key as resourceId.
      resourceLabel = input.resourceId;
    } else {
      resourceLabel = input.resourceId;
    }
  }
  return { actorEmail, actorName, resourceLabel };
}
