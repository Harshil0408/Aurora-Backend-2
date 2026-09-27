import { getPrisma } from '../../../../config/db.js';

export async function queryAuditLog(
  page: number,
  limit: number,
  action?: string,
): Promise<{ data: unknown[]; total: number }> {
  const prisma = getPrisma();
  const where = action ? { action } : {};
  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
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
