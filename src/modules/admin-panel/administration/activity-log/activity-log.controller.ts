import type { Request, Response } from 'express';
import { z } from 'zod';
import { paginated } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import { paginationSchema } from '../../../../shared/validation/pagination.js';
import { queryAuditLog } from './activity-log.service.js';

const auditQuerySchema = paginationSchema.extend({
  action: z.string().min(1).max(128).optional(),
  resourceType: z.string().min(1).max(64).optional(),
  resourceId: z.string().min(1).max(64).optional(),
});

export const queryAuditHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.AUDIT_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit, action, resourceType, resourceId } = auditQuerySchema.parse(req.query);
    const { data, total } = await queryAuditLog({ page, limit, action, resourceType, resourceId });
    res.status(200).json(paginated(data, page, limit, total));
  }),
];
