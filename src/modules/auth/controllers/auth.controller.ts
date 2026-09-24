import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import { getEnv } from '../../../config/env.js';
import { badRequest, forbidden, unauthorized } from '../../../shared/errors/AppError.js';
import { ok, paginated } from '../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../shared/utils/requestMeta.js';
import { PERMISSIONS, hasPermission } from '../../rbac/permissions.js';
import { getEffectivePermissions } from '../../rbac/rbac.service.js';
import { getPrisma } from '../../../config/db.js';
import { verifyPendingToken } from '../crypto/tokens.js';
import { getAuth, requireAuth } from '../middleware/requireAuth.js';
import { loginWithPassword } from '../services/login.service.js';
import {
  requestPasswordReset,
  resetPassword,
  changePassword,
} from '../services/passwordReset.service.js';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_IDLE_MS,
  issueSession,
  listActiveSessions,
  rotateSession,
  revokeAllSessions,
  revokeSession,
} from '../services/session.service.js';
import {
  beginEnrollment,
  confirmEnrollment,
  disableTwoFactor,
  verifySecondFactor,
} from '../services/twoFactor.service.js';
import {
  changePasswordSchema,
  disableTwoFactorSchema,
  forgotPasswordSchema,
  loginSchema,
  paginationSchema,
  pendingTokenSchema,
  resetPasswordSchema,
  totpCodeSchema,
} from '../validation/auth.schemas.js';

function refreshCookieOptions(): CookieOptions {
  const env = getEnv();
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: `${env.API_PREFIX}/admin/auth`,
    maxAge: REFRESH_IDLE_MS,
  };
}

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions());
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
}

/** POST /api/v1/admin/auth/login — thin: validate, delegate, respond. */
export const login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const body = loginSchema.parse(req.body);
  const result = await loginWithPassword(body, getRequestMeta(req));
  res.status(200).json(ok(result));
});

function verifiedPendingAdmin(req: Request): string {
  const { pendingToken } = pendingTokenSchema.parse(req.body);
  const verified = verifyPendingToken(pendingToken);
  if (!verified.valid) throw unauthorized('Invalid or expired token');
  return verified.adminId;
}

/** POST /auth/2fa/enroll — pending token only. Returns QR + one-time recovery codes. */
export const enroll2fa = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const adminId = verifiedPendingAdmin(req);
  const result = await beginEnrollment(adminId);
  res.status(200).json(ok(result));
});

/** POST /auth/2fa/confirm — activate after proving the authenticator works. */
export const confirm2fa = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { pendingToken, code } = totpCodeSchema.parse(req.body);
  const verified = verifyPendingToken(pendingToken);
  if (!verified.valid) throw unauthorized('Invalid or expired token');
  await confirmEnrollment(verified.adminId, code, getRequestMeta(req));
  res.status(200).json(ok({ enrolled: true }));
});

/** POST /auth/2fa/verify — full login: issues access JWT + refresh cookie. */
export const verify2fa = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { pendingToken, code } = totpCodeSchema.parse(req.body);
  const pending = verifyPendingToken(pendingToken);
  if (!pending.valid) throw unauthorized('Invalid or expired token');

  // Enrollment started but never confirmed: TOTP codes are correct yet
  // verifySecondFactor would reject them (requires totpEnabled). Tell the
  // caller to finish setup via /2fa/confirm instead of a misleading
  // "Invalid verification code".
  const prisma = getPrisma();
  const pendingAdmin = await prisma.adminUser.findUnique({ where: { id: pending.adminId } });
  if (pendingAdmin && !pendingAdmin.totpEnabled) {
    throw badRequest(
      pendingAdmin.totpSecretEncrypted
        ? '2FA setup not finished — call POST /2fa/confirm with your authenticator code'
        : '2FA not set up — call POST /2fa/enroll first',
    );
  }

  const meta = getRequestMeta(req);
  const method = await verifySecondFactor(pending.adminId, code, meta);
  if (!method) throw unauthorized('Invalid verification code');

  const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: pending.adminId } });
  const perms = await getEffectivePermissions(admin.id);
  const issued = await issueSession({
    adminId: admin.id,
    permissions: [...perms],
    tokenVersion: admin.tokenVersion,
    meta,
  });
  setRefreshCookie(res, issued.refreshToken);
  res
    .status(200)
    .json(
      ok({ accessToken: issued.accessToken, expiresInSeconds: issued.expiresInSeconds, method }),
    );
});

/** POST /auth/refresh — rotate refresh token, return fresh access JWT. */
export const refresh = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const presented = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!presented) throw unauthorized('Invalid session');
  const issued = await rotateSession({ presentedToken: presented, meta: getRequestMeta(req) });
  setRefreshCookie(res, issued.refreshToken);
  res
    .status(200)
    .json(ok({ accessToken: issued.accessToken, expiresInSeconds: issued.expiresInSeconds }));
});

/** POST /auth/logout — revoke current session. */
export const logout = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    await revokeSession(auth.sessionId, auth.adminId, getRequestMeta(req), 'logout');
    clearRefreshCookie(res);
    res.status(200).json(ok({ loggedOut: true }));
  }),
];

/** POST /auth/logout-all — revoke everything incl. all JWTs (tokenVersion bump). */
export const logoutAll = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    await revokeAllSessions(auth.adminId, getRequestMeta(req));
    clearRefreshCookie(res);
    res.status(200).json(ok({ loggedOut: true }));
  }),
];

/** GET /auth/sessions — own active sessions (auth only; others are never listed here). */
export const listSessions = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { page, limit } = paginationSchema.parse(req.query);
    const { data, total } = await listActiveSessions(auth.adminId, auth.sessionId, page, limit);
    res.status(200).json(paginated(data, page, limit, total));
  }),
];

const sessionIdParams = z.object({ id: z.string().min(1) });

/** DELETE /auth/sessions/:id — own sessions always; others need session.revoke. */
export const revokeOneSession = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = sessionIdParams.parse(req.params);
    const prisma = getPrisma();
    const target = await prisma.adminSession.findUnique({ where: { id } });
    if (!target || target.revokedAt !== null) {
      res.status(200).json(ok({ revoked: true }));
      return;
    }
    if (
      target.adminId !== auth.adminId &&
      !hasPermission(auth.permissions, PERMISSIONS.SESSION_REVOKE)
    ) {
      throw forbidden('Insufficient permissions');
    }
    await revokeSession(id, target.adminId, getRequestMeta(req));
    res.status(200).json(ok({ revoked: true }));
  }),
];

/** POST /auth/forgot-password — always generic 200 (no enumeration). */
export const forgotPassword = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { email } = forgotPasswordSchema.parse(req.body);
  await requestPasswordReset(email, getRequestMeta(req));
  res.status(200).json(ok({ message: 'If the account exists, a reset token was sent' }));
});

/** POST /auth/reset-password — single-use token, history check, kills sessions. */
export const resetPasswordHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { token, newPassword } = resetPasswordSchema.parse(req.body);
    await resetPassword({ token, newPassword, meta: getRequestMeta(req) });
    res.status(200).json(ok({ reset: true }));
  },
);

/** POST /auth/change-password — reauth + history check, kills sessions. */
export const changePasswordHandler = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await changePassword({
      adminId: auth.adminId,
      currentPassword,
      newPassword,
      meta: getRequestMeta(req),
    });
    clearRefreshCookie(res);
    res.status(200).json(ok({ changed: true }));
  }),
];

/** POST /auth/2fa/disable — password + 2FA reauth, wipes secret, kills sessions. */
export const disable2fa = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { password, code } = disableTwoFactorSchema.parse(req.body);
    await disableTwoFactor({ adminId: auth.adminId, password, code, meta: getRequestMeta(req) });
    clearRefreshCookie(res);
    res.status(200).json(ok({ disabled: true }));
  }),
];
