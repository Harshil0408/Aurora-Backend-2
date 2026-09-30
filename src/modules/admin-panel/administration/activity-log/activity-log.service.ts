import { getPrisma } from '../../../../config/db.js';

export interface AuditLogQuery {
  page: number;
  limit: number;
  action?: string | undefined;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
}

export async function queryAuditLog(
  query: AuditLogQuery,
): Promise<{ data: unknown[]; total: number }> {
  const prisma = getPrisma();
  const where: { action?: string; resourceType?: string; resourceId?: string } = {};
  if (query.action) where.action = query.action;
  if (query.resourceType) where.resourceType = query.resourceType;
  if (query.resourceId) where.resourceId = query.resourceId;
  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.adminAuditLog.count({ where }),
  ]);
  return {
    data: rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      before: r.before,
      after: r.after,
      ipAddress: r.ipAddress,
      requestId: r.requestId,
      createdAt: r.createdAt,
    })),
    total,
  };
}
