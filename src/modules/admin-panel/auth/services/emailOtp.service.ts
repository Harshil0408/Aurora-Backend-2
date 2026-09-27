import { randomInt } from 'node:crypto';
import { getPrisma } from '../../../../config/db.js';
import { logger } from '../../../../config/logger.js';
import { badRequest, forbidden, unauthorized } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { getMailer } from '../../../../infra/mail/mailer.js';
import { hashSecret, verifySecret } from '../crypto/password.js';
import { buildEmailOtpMail } from '../utils/otpMail.js';
import { logLoginEvent } from './loginActivity.service.js';
import { revokeAllSessions } from './session.service.js';

export const EMAIL_OTP_TTL_MS = 10 * 60_000; // 10 minutes
export const EMAIL_OTP_MAX_ATTEMPTS = 5;

export const EMAIL_OTP_PURPOSE_ENABLE = 'ENABLE';
export const EMAIL_OTP_PURPOSE_LOGIN = 'LOGIN';

/**
 * Issue a fresh 6-digit emailed OTP. Single-outstanding per admin — any
 * previous unused code is voided. Mail failures never fail the request
 * (LogMailer in dev; SMTP outage must not lock anyone out — resend works).
 */
export async function requestEmailOtp(
  adminId: string,
  email: string,
  purpose: string,
  meta: RequestMeta,
): Promise<void> {
  const prisma = getPrisma();
  const code = randomInt(100_000, 1_000_000).toString();
  const codeHash = await hashSecret(code);

  await prisma.$transaction(async (tx) => {
    await tx.adminEmailOtp.updateMany({
      where: { adminId, usedAt: null },
      data: { usedAt: new Date() }, // void previous outstanding codes
    });
    await tx.adminEmailOtp.create({
      data: {
        adminId,
        codeHash,
        purpose,
        expiresAt: new Date(Date.now() + EMAIL_OTP_TTL_MS),
      },
    });
    await logLoginEvent(tx, { adminId, event: 'TWO_FA_CHALLENGE', meta });
  });

  try {
    const mail = buildEmailOtpMail(code, purpose === EMAIL_OTP_PURPOSE_ENABLE ? 'enable' : 'login');
    await getMailer().send({ to: email, subject: mail.subject, text: mail.text, html: mail.html });
  } catch (err: unknown) {
    // The code row already exists — ops/user can resend. Never 500 here.
    logger.error('Email OTP mail failed to send', {
      adminId,
      requestId: meta.requestId,
      error: err instanceof Error ? err.message : err,
    });
  }
}

/**
 * Verify an outstanding emailed OTP. Wrong codes burn one of 5 attempts;
 * expired/exhausted codes fail closed. Returns true on first valid use.
 */
export async function verifyEmailOtp(
  adminId: string,
  code: string,
  meta: RequestMeta,
): Promise<boolean> {
  const prisma = getPrisma();
  const row = await prisma.adminEmailOtp.findFirst({
    where: { adminId, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) {
    await logLoginEvent(prisma, { adminId, event: 'TWO_FA_FAILURE', meta });
    return false;
  }
  if (row.attempts >= EMAIL_OTP_MAX_ATTEMPTS) {
    await prisma.adminEmailOtp.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
    await logLoginEvent(prisma, { adminId, event: 'TWO_FA_FAILURE', meta });
    return false;
  }
  if (!(await verifySecret(row.codeHash, code.trim()))) {
    await prisma.$transaction(async (tx) => {
      await tx.adminEmailOtp.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      await logLoginEvent(tx, { adminId, event: 'TWO_FA_FAILURE', meta });
    });
    return false;
  }
  await prisma.$transaction(async (tx) => {
    await tx.adminEmailOtp.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await logLoginEvent(tx, { adminId, event: 'TWO_FA_SUCCESS', meta });
  });
  return true;
}

interface EnableEmailOtpInput {
  adminId: string;
  code: string;
  meta: RequestMeta;
}

/** Confirm mailbox ownership → email OTP becomes a login second factor. */
export async function enableEmailOtp(input: EnableEmailOtpInput): Promise<void> {
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUnique({ where: { id: input.adminId } });
  if (!admin || admin.status !== 'ACTIVE') throw forbidden('Account is not active');
  if (admin.emailOtpEnabled) return; // idempotent
  if (!(await verifyEmailOtp(input.adminId, input.code, input.meta))) {
    throw unauthorized('Invalid or expired code');
  }
  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: input.adminId },
      data: { emailOtpEnabled: true, emailOtpEnrolledAt: new Date() },
    });
    await logLoginEvent(tx, { adminId: input.adminId, event: 'TWO_FA_ENROLLED', meta: input.meta });
  });
}

interface DisableEmailOtpInput {
  adminId: string;
  password: string;
  code: string;
  meta: RequestMeta;
}

/**
 * Disable email-OTP 2FA: requires current password + a valid emailed code
 * (request one first), then revokes ALL sessions like the TOTP disable.
 */
export async function disableEmailOtp(input: DisableEmailOtpInput): Promise<void> {
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUnique({ where: { id: input.adminId } });
  if (!admin) throw unauthorized('Invalid credentials');
  if (!(await verifySecret(admin.passwordHash, input.password))) {
    throw unauthorized('Invalid credentials');
  }
  if (!admin.emailOtpEnabled) throw badRequest('Email OTP is not enabled');
  if (!(await verifyEmailOtp(input.adminId, input.code, input.meta))) {
    throw unauthorized('Invalid or expired code');
  }
  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: input.adminId },
      data: { emailOtpEnabled: false, emailOtpEnrolledAt: null },
    });
    await tx.adminEmailOtp.updateMany({
      where: { adminId: input.adminId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await logLoginEvent(tx, {
      adminId: input.adminId,
      event: 'TWO_FA_DISABLED',
      meta: input.meta,
    });
  });
  await revokeAllSessions(input.adminId, input.meta);
}
