import { randomBytes } from 'node:crypto';
import { getPrisma } from '../../../config/db.js';
import { logger } from '../../../config/logger.js';
import { badRequest, unauthorized } from '../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../shared/utils/requestMeta.js';
import { getMailer } from '../../../infra/mail/mailer.js';
import { hashSecret, verifySecret } from '../crypto/password.js';
import { hashToken } from '../crypto/tokenHash.js';
import { normalizeEmail } from '../utils/email.js';
import { logLoginEvent } from './loginActivity.service.js';
import { revokeAllSessions } from './session.service.js';

export const RESET_TOKEN_TTL_MS = 60 * 60_000; // 1 hour
const PASSWORD_HISTORY_LIMIT = 5;

/** Always resolves successfully — never reveals whether the email exists. */
export async function requestPasswordReset(email: string, meta: RequestMeta): Promise<void> {
  const prisma = getPrisma();
  const emailNormalized = normalizeEmail(email);
  const admin = await prisma.adminUser.findUnique({ where: { emailNormalized } });

  if (admin && admin.status === 'ACTIVE') {
    const token = randomBytes(32).toString('base64url');
    await prisma.$transaction(async (tx) => {
      await tx.adminPasswordResetToken.updateMany({
        where: { adminId: admin.id, usedAt: null },
        data: { usedAt: new Date() }, // single outstanding token
      });
      await tx.adminPasswordResetToken.create({
        data: {
          adminId: admin.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      await logLoginEvent(tx, { adminId: admin.id, event: 'PASSWORD_RESET_REQUESTED', meta });
    });
    try {
      await getMailer().send({
        to: admin.email,
        subject: 'Admin password reset',
        text: `Use this one-time token within 1 hour: ${token}`,
      });
    } catch (err: unknown) {
      // Mail provider outage must not reveal account existence (500 vs 200)
      // nor lose the request — the token row already exists; ops can resend.
      logger.error('Password reset mail failed to send', {
        adminId: admin.id,
        requestId: meta.requestId,
        error: err instanceof Error ? err.message : err,
      });
    }
  } else {
    logger.info('Password reset requested for unknown/inactive email', {
      requestId: meta.requestId,
    });
  }
}

interface ResetInput {
  token: string;
  newPassword: string;
  meta: RequestMeta;
}

export async function resetPassword(input: ResetInput): Promise<void> {
  const prisma = getPrisma();
  const row = await prisma.adminPasswordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { admin: true },
  });
  if (!row || row.usedAt !== null || row.expiresAt.getTime() <= Date.now()) {
    throw badRequest('Invalid or expired reset token');
  }
  if (row.admin.status !== 'ACTIVE') throw badRequest('Invalid or expired reset token');

  await rejectRecentlyUsed(row.adminId, input.newPassword);
  const passwordHash = await hashSecret(input.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.adminPasswordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
    await tx.adminUser.update({
      where: { id: row.adminId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    await tx.adminPasswordHistory.create({ data: { adminId: row.adminId, passwordHash } });
    await tx.adminPasswordHistory.deleteMany({
      where: {
        adminId: row.adminId,
        id: {
          notIn: (
            await tx.adminPasswordHistory.findMany({
              where: { adminId: row.adminId },
              orderBy: { createdAt: 'desc' },
              take: PASSWORD_HISTORY_LIMIT,
              select: { id: true },
            })
          ).map((h) => h.id),
        },
      },
    });
    await logLoginEvent(tx, {
      adminId: row.adminId,
      event: 'PASSWORD_RESET_COMPLETED',
      meta: input.meta,
    });
  });

  // New password ⇒ all sessions die (throws nothing on success path).
  await revokeAllSessions(row.adminId, input.meta);
}

interface ChangeInput {
  adminId: string;
  currentPassword: string;
  newPassword: string;
  meta: RequestMeta;
}

/** Authenticated change: reauthenticates with the current password. */
export async function changePassword(input: ChangeInput): Promise<void> {
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUnique({ where: { id: input.adminId } });
  if (!admin) throw unauthorized('Invalid credentials');
  if (!(await verifySecret(admin.passwordHash, input.currentPassword))) {
    throw unauthorized('Current password is incorrect');
  }
  await rejectRecentlyUsed(input.adminId, input.newPassword);
  const passwordHash = await hashSecret(input.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: input.adminId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
    await tx.adminPasswordHistory.create({ data: { adminId: input.adminId, passwordHash } });
    await logLoginEvent(tx, {
      adminId: input.adminId,
      event: 'PASSWORD_CHANGED',
      meta: input.meta,
    });
  });
  await revokeAllSessions(input.adminId, input.meta);
}

async function rejectRecentlyUsed(adminId: string, candidate: string): Promise<void> {
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
  // Current hash first: history is expected to contain it, but must not be
  // solely relied upon if a legacy row predates history tracking.
  if (await verifySecret(admin.passwordHash, candidate)) {
    throw badRequest('New password must not match a recently used password');
  }
  const recent = await prisma.adminPasswordHistory.findMany({
    where: { adminId },
    orderBy: { createdAt: 'desc' },
    take: PASSWORD_HISTORY_LIMIT,
  });
  for (const row of recent) {
    if (await verifySecret(row.passwordHash, candidate)) {
      throw badRequest('New password must not match a recently used password');
    }
  }
}
