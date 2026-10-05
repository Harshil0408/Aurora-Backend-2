import type { Request, Response } from 'express';
import { z } from 'zod';
import { ok, paginated } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import { paginationSchema } from '../../../../shared/validation/pagination.js';
import {
  getActivityEntry,
  listActionOptions,
  listActivity,
  queryAuditLog,
} from './activity-log.service.js';
import {
  activityFilterSchema,
  activityIdParams,
  activityQuerySchema,
} from './activity-log.schemas.js';

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

/** Activity feed list: newest-first entries with snapshots + derived diffs. */
export const listActivityHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.AUDIT_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit, action, q, actor, from, to, sort } = activityQuerySchema.parse(req.query);
    const { data, total } = await listActivity({
      page,
      limit,
      actions: action,
      q,
      actor,
      from,
      to,
      sort,
    });
    res.status(200).json(paginated(data, page, limit, total));
  }),
];

/** Feed filter options: distinct actions + counts honoring the other active filters. */
export const listActionOptionsHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.AUDIT_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { q, actor, from, to } = activityFilterSchema.parse(req.query);
    res.status(200).json(ok(await listActionOptions({ q, actor, from, to })));
  }),
];

/** Single feed entry for deep links / full diffs. */
export const getActivityEntryHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.AUDIT_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = activityIdParams.parse(req.params);
    res.status(200).json(ok(await getActivityEntry(id)));
  }),
];
