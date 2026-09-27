import type { Request, Response } from 'express';
import { ok, paginated } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { paginationSchema } from '../../../../shared/validation/pagination.js';
import { sessionIdParams } from './sessions.schemas.js';
import { listMySessions, revokeSessionById } from './sessions.service.js';

/** GET /auth/sessions — own active sessions (others are never listed here). */
export const listMySessionsHandler = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { page, limit } = paginationSchema.parse(req.query);
    const { data, total } = await listMySessions(auth.adminId, auth.sessionId, page, limit);
    res.status(200).json(paginated(data, page, limit, total));
  }),
];

/** DELETE /auth/sessions/:id — revoke one session (revoking current logs you out). */
export const revokeOneSessionHandler = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = sessionIdParams.parse(req.params);
    const result = await revokeSessionById(id, auth, getRequestMeta(req));
    res.status(200).json(ok(result));
  }),
];
