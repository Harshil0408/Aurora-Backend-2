import { getPrisma } from '../../../../config/db.js';
import { logger } from '../../../../config/logger.js';
import { unauthorized } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PENDING_TOKEN_TTL_SECONDS, signPendingToken } from '../crypto/tokens.js';
import { verifySecret } from '../crypto/password.js';
import { normalizeEmail } from '../utils/email.js';
import type { LoginInput } from '../validation/auth.schemas.js';
import { logLoginEvent } from './loginActivity.service.js';
import { getEffectivePermissions } from '../../../rbac/rbac.service.js';
import { issueSession } from './session.service.js';
import { EMAIL_OTP_PURPOSE_LOGIN, requestEmailOtp } from './emailOtp.service.js';

export type SecondFactorChannel = 'totp' | 'email_otp';

export type PasswordLoginResult =
  | {
      requires2fa: true;
      /** Which second factor the pending token must satisfy (TOTP wins when both on). */
      channel: SecondFactorChannel;
      /** 2FA-pending JWT — proves password OK, grants nothing. */
      pendingToken: string;
      expiresInSeconds: number;
    }
  | {
      requires2fa: false;
      /** No 2FA method enabled — session issued directly. */
      accessToken: string;
      /** Raw refresh token — set as HttpOnly cookie by the controller. */
      refreshToken: string;
      expiresInSeconds: number;
    };

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

/**
 * Argon2id hash of an unknown random secret. Verified against when the
 * email doesn't exist, so unknown-email and wrong-password attempts cost
 * the same ~150ms (timing-attack + enumeration hardening).
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$R/U1uktF9yJeqkoaNa+05w$o/Ndl7DEm+P4vA5epKkIpP7ckSfi0Qk0CiXyaqBYvyE';

export async function loginWithPassword(
  input: LoginInput,
  meta: RequestMeta,
): Promise<PasswordLoginResult> {
  const prisma = getPrisma();
  const emailNormalized = normalizeEmail(input.email);

  const admin = await prisma.adminUser.findUnique({ where: { emailNormalized } });
  const passwordOk = await verifySecret(admin?.passwordHash ?? DUMMY_HASH, input.password);

  if (!admin || !passwordOk) {
    if (admin) {
      const attempts = admin.failedLoginAttempts + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS && !admin.lockedUntil;
      await prisma.$transaction(async (tx) => {
        await tx.adminUser.update({
          where: { id: admin.id },
          data: {
            failedLoginAttempts: attempts,
            ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) } : {}),
          },
        });
        await logLoginEvent(tx, {
          adminId: admin.id,
          event: shouldLock ? 'ACCOUNT_LOCKED' : 'LOGIN_FAILURE',
          meta,
        });
      });
      if (shouldLock) {
        logger.warn('Admin account locked after failed logins', {
          adminId: admin.id,
          requestId: meta.requestId,
        });
      }
    } else {
      await logLoginEvent(prisma, { adminId: null, event: 'LOGIN_FAILURE', meta });
    }
    throw unauthorized('Invalid email or password');
  }

  if (admin.status !== 'ACTIVE') {
    await logLoginEvent(prisma, { adminId: admin.id, event: 'LOGIN_BLOCKED_STATUS', meta });
    throw unauthorized('Invalid email or password');
  }
  if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
    await logLoginEvent(prisma, { adminId: admin.id, event: 'LOGIN_FAILURE', meta });
    throw unauthorized('Invalid email or password');
  }

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: admin.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
    await logLoginEvent(tx, { adminId: admin.id, event: 'LOGIN_SUCCESS', meta });
  });

  // No 2FA method enabled → direct login with credentials (full session now).
  if (!admin.totpEnabled && !admin.emailOtpEnabled) {
    const perms = await getEffectivePermissions(admin.id);
    const issued = await issueSession({
      adminId: admin.id,
      permissions: [...perms],
      tokenVersion: admin.tokenVersion,
      meta,
    });
    return {
      requires2fa: false,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresInSeconds: issued.expiresInSeconds,
    };
  }

  // TOTP wins when both methods are on — the pending token carries no
  // channel; verify resolves the method from the admin row instead.
  if (!admin.totpEnabled) {
    await requestEmailOtp(admin.id, admin.email, EMAIL_OTP_PURPOSE_LOGIN, meta);
    return {
      requires2fa: true,
      channel: 'email_otp',
      pendingToken: signPendingToken(admin.id),
      expiresInSeconds: PENDING_TOKEN_TTL_SECONDS,
    };
  }

  return {
    requires2fa: true,
    channel: 'totp',
    pendingToken: signPendingToken(admin.id),
    expiresInSeconds: PENDING_TOKEN_TTL_SECONDS,
  };
}
