import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getPrisma } from '../../../config/db.js';
import { requireSellerAuth } from '../auth/middleware/requireSellerAuth.js';
import { getStoreAuth, requireStoreAccess } from '../stores/middleware/requireStoreAccess.js';
import { STORE_PERMISSIONS } from '../team/store-permissions.js';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().max(128).optional(),
});

export const listStoreAuditHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.STORE_READ),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const storeAuth = getStoreAuth(req);
      const q = querySchema.parse(req.query);
      const prisma = getPrisma();
      const where = {
        storeId: storeAuth.storeId,
        ...(q.action ? { action: q.action } : {}),
      };
      const [rows, total] = await Promise.all([
        prisma.storeAuditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        prisma.storeAuditLog.count({ where }),
      ]);
      res.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit } });
    } catch (err) {
      next(err);
    }
  },
];
