import { getPrisma } from '../../../../config/db.js';
import { forbidden } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS, hasPermission } from '../../../rbac/permissions.js';
import { listActiveSessions, revokeSession } from '../../../auth/services/session.service.js';
import type { ActiveSessionView } from '../../../auth/services/session.service.js';

/** "My sessions" table — own active sessions with current-session highlight. */
export async function listMySessions(
  adminId: string,
  sessionId: string,
  page: number,
  limit: number,
): Promise<{ data: ActiveSessionView[]; total: number }> {
  return listActiveSessions(adminId, sessionId, page, limit);
}

export interface SessionActor {
  adminId: string;
  permissions: Set<string>;
}

/**
 * Revoke one session (confirm dialog in UI).
 * Own sessions always; revoking another admin's session needs session.revoke.
 * Idempotent — already-gone sessions report revoked. Revoking the current
 * session logs the caller out, so the UI must warn before confirming.
 */
export async function revokeSessionById(
  sessionId: string,
  actor: SessionActor,
  meta: RequestMeta,
): Promise<{ revoked: true }> {
  const prisma = getPrisma();
  const target = await prisma.adminSession.findUnique({ where: { id: sessionId } });
  if (!target || target.revokedAt !== null) return { revoked: true };
  if (
    target.adminId !== actor.adminId &&
    !hasPermission(actor.permissions, PERMISSIONS.SESSION_REVOKE)
  ) {
    throw forbidden('Insufficient permissions');
  }
  await revokeSession(sessionId, target.adminId, meta);
  return { revoked: true };
}
