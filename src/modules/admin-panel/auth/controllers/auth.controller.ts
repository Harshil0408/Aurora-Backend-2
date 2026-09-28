import type { CookieOptions, Request, Response } from 'express';
import { getEnv } from '../../../../config/env.js';
import { badRequest, unauthorized } from '../../../../shared/errors/AppError.js';
import { ok } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { getEffectivePermissions } from '../../../rbac/rbac.service.js';
import { getPrisma } from '../../../../config/db.js';
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
  EMAIL_OTP_PURPOSE_ENABLE,
  EMAIL_OTP_PURPOSE_LOGIN,
  disableEmailOtp,
  enableEmailOtp,
  requestEmailOtp,
  verifyEmailOtp,
} from '../services/emailOtp.service.js';
import { getAdminProfile } from '../services/me.service.js';
import {
  changePasswordSchema,
  disableEmailOtpSchema,
  disableTwoFactorSchema,
  forgotPasswordSchema,
  loginSchema,
  pendingTokenSchema,
  resetPasswordSchema,
  totpCodeSchema,
  twoFactorCodeSchema,
} from '../validation/auth.schemas.js';

function refreshCookieOptions(): CookieOptions {
  const env = getEnv();
  // Frontend (vercel.app) ↔ API (onrender.com) is cross-site: `SameSite=Strict`
  // cookies are never sent on cross-site fetches, so refresh/rotation would
  // silently break in production. `None` + `Secure` is required for
  // cross-site cookies; local dev stays Lax (Strict also blocks top-level
  // navigation flows and is unnecessarily harsh for localhost).
  const isProduction = env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
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

/**
 * POST /api/v1/admin/auth/login — thin: validate, delegate, respond.
 * No 2FA method enabled → session issued directly (200 + access JWT +
 * refresh cookie). Otherwise a 2FA-pending token with the channel to
 * satisfy (`totp` wins when both methods are on).
 */
export const login = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const body = loginSchema.parse(req.body);
  const result = await loginWithPassword(body, getRequestMeta(req));
  if (!result.requires2fa) {
    setRefreshCookie(res, result.refreshToken);
    res.status(200).json(
      ok({
        requires2fa: false,
        accessToken: result.accessToken,
        expiresInSeconds: result.expiresInSeconds,
      }),
    );
    return;
  }
  res.status(200).json(ok(result));
});

/** GET /api/v1/admin/auth/me — logged-in admin profile (top bar, badges, 2FA UI). */
export const getMe = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    res.status(200).json(ok(await getAdminProfile(auth.adminId, auth.permissions)));
  }),
];

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

  const prisma = getPrisma();
  const pendingAdmin = await prisma.adminUser.findUnique({ where: { id: pending.adminId } });
  if (!pendingAdmin || pendingAdmin.status !== 'ACTIVE') {
    throw unauthorized('Invalid email or password');
  }

  const meta = getRequestMeta(req);

  // Email-OTP method (TOTP wins when both are on — same precedence as login).
  if (!pendingAdmin.totpEnabled && pendingAdmin.emailOtpEnabled) {
    if (!(await verifyEmailOtp(pending.adminId, code, meta))) {
      throw unauthorized('Invalid or expired code');
    }
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: pending.adminId } });
    const perms = await getEffectivePermissions(admin.id);
    const issued = await issueSession({
      adminId: admin.id,
      permissions: [...perms],
      tokenVersion: admin.tokenVersion,
      meta,
    });
    setRefreshCookie(res, issued.refreshToken);
    res.status(200).json(
      ok({
        accessToken: issued.accessToken,
        expiresInSeconds: issued.expiresInSeconds,
        method: 'email_otp',
      }),
    );
    return;
  }

  // Enrollment started but never confirmed: TOTP codes are correct yet
  // verifySecondFactor would reject them (requires totpEnabled). Tell the
  // caller to finish setup via /2fa/confirm instead of a misleading
  // "Invalid verification code".
  if (!pendingAdmin.totpEnabled) {
    throw badRequest(
      pendingAdmin.totpSecretEncrypted
        ? '2FA setup not finished — call POST /2fa/confirm with your authenticator code'
        : '2FA not set up — log in directly with email and password',
    );
  }

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

/** POST /auth/2fa/disable — password + TOTP reauth, wipes secret, kills sessions. */
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

/**
 * Authenticated TOTP enable (Security page): logged-in admin starts
 * enrollment here — the legacy pending-token /2fa/enroll stays for
 * re-enrollment flows. Next login challenges with TOTP.
 */
export const enrollTotpAuthed = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    res.status(200).json(ok(await beginEnrollment(auth.adminId)));
  }),
];

export const confirmTotpAuthed = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { code } = twoFactorCodeSchema.parse(req.body);
    await confirmEnrollment(auth.adminId, code, getRequestMeta(req));
    res.status(200).json(ok({ enrolled: true }));
  }),
];

/** POST /auth/2fa/email/request — email a code proving mailbox ownership. */
export const requestEmailOtpHandler = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const prisma = getPrisma();
    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: auth.adminId } });
    await requestEmailOtp(admin.id, admin.email, EMAIL_OTP_PURPOSE_ENABLE, getRequestMeta(req));
    res.status(200).json(ok({ sent: true }));
  }),
];

/** POST /auth/2fa/email/confirm — valid code enables email-OTP 2FA. */
export const confirmEmailOtpHandler = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { code } = twoFactorCodeSchema.parse(req.body);
    await enableEmailOtp({ adminId: auth.adminId, code, meta: getRequestMeta(req) });
    res.status(200).json(ok({ enrolled: true }));
  }),
];

/** POST /auth/2fa/email/disable — password + fresh emailed code, kills sessions. */
export const disableEmailOtpHandler = [
  requireAuth,
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { password, code } = disableEmailOtpSchema.parse(req.body);
    await disableEmailOtp({
      adminId: auth.adminId,
      password,
      code,
      meta: getRequestMeta(req),
    });
    clearRefreshCookie(res);
    res.status(200).json(ok({ disabled: true }));
  }),
];

/** POST /auth/2fa/email/resend — pending token only, re-sends the login code. */
export const resendEmailOtpHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const adminId = verifiedPendingAdmin(req);
    const prisma = getPrisma();
    const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin || admin.status !== 'ACTIVE' || !admin.emailOtpEnabled) {
      throw badRequest('Email OTP is not enabled for this account');
    }
    await requestEmailOtp(admin.id, admin.email, EMAIL_OTP_PURPOSE_LOGIN, getRequestMeta(req));
    res.status(200).json(ok({ sent: true }));
  },
);
