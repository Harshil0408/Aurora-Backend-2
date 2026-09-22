import QRCode from 'qrcode';
import { getPrisma } from '../../../config/db.js';
import { forbidden, unauthorized } from '../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../shared/utils/requestMeta.js';
import { verifySecret } from '../crypto/password.js';
import {
  generateRecoveryCodes,
  hashRecoveryCodes,
  verifyRecoveryCode,
} from '../crypto/recoveryCodes.js';
import { beginTotpEnrollment, decryptTotpSecret, verifyTotpCode } from '../crypto/totp.js';
import { logLoginEvent } from './loginActivity.service.js';
import { revokeAllSessions } from './session.service.js';

export interface EnrollmentResult {
  otpauthUrl: string;
  qrDataUrl: string;
  /** Plaintext recovery codes — shown ONCE, then unrecoverable. */
  recoveryCodes: string[];
}

/**
 * Start (or restart) 2FA enrollment. Stores the encrypted secret with
 * totpEnabled=false — it activates only after the initial code is
 * verified (confirmEnrollment), so a half-finished enrollment can never
 * lock the admin out or count as secured.
 */
export async function beginEnrollment(adminId: string): Promise<EnrollmentResult> {
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
  if (admin.status !== 'ACTIVE') throw forbidden('Account is not active');

  const enrollment = beginTotpEnrollment(admin.email);
  const codes = generateRecoveryCodes();
  const hashed = await hashRecoveryCodes(codes);

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: adminId },
      data: { totpSecretEncrypted: enrollment.encryptedSecret, totpEnabled: false },
    });
    await tx.adminRecoveryCode.deleteMany({ where: { adminId } });
    await tx.adminRecoveryCode.createMany({
      data: hashed.map((codeHash) => ({ adminId, codeHash })),
    });
  });

  return {
    otpauthUrl: enrollment.otpauthUrl,
    qrDataUrl: await QRCode.toDataURL(enrollment.otpauthUrl),
    recoveryCodes: codes,
  };
}

/** Activate 2FA after proving the authenticator app works. */
export async function confirmEnrollment(
  adminId: string,
  code: string,
  meta: RequestMeta,
): Promise<void> {
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
  if (admin.totpEnabled) return; // idempotent
  if (!admin.totpSecretEncrypted) throw unauthorized('Enrollment not started');

  const secret = decryptTotpSecret(admin.totpSecretEncrypted);
  if (!secret || !verifyTotpCode(secret, code)) {
    await logLoginEvent(prisma, { adminId, event: 'TWO_FA_FAILURE', meta });
    throw unauthorized('Invalid verification code');
  }

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: adminId },
      data: { totpEnabled: true, totpEnrolledAt: new Date() },
    });
    await logLoginEvent(tx, { adminId, event: 'TWO_FA_ENROLLED', meta });
  });
}

export type SecondFactorMethod = 'totp' | 'recovery';

/**
 * Verify the second factor. TOTP first, then single-use recovery codes
 * (each code row is stamped usedAt — replay impossible).
 */
export async function verifySecondFactor(
  adminId: string,
  code: string,
  meta: RequestMeta,
): Promise<SecondFactorMethod | null> {
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  if (!admin || admin.status !== 'ACTIVE' || !admin.totpEnabled || !admin.totpSecretEncrypted) {
    return null;
  }

  const secret = decryptTotpSecret(admin.totpSecretEncrypted);
  if (secret && verifyTotpCode(secret, code)) {
    await logLoginEvent(prisma, { adminId, event: 'TWO_FA_SUCCESS', meta });
    return 'totp';
  }

  const unused = await prisma.adminRecoveryCode.findMany({
    where: { adminId, usedAt: null },
  });
  for (const row of unused) {
    if (await verifyRecoveryCode(row.codeHash, code)) {
      await prisma.$transaction(async (tx) => {
        await tx.adminRecoveryCode.update({
          where: { id: row.id },
          data: { usedAt: new Date() },
        });
        await logLoginEvent(tx, { adminId, event: 'RECOVERY_CODE_USED', meta });
      });
      return 'recovery';
    }
  }

  await logLoginEvent(prisma, { adminId, event: 'TWO_FA_FAILURE', meta });
  return null;
}

interface DisableInput {
  adminId: string;
  password: string;
  code: string;
  meta: RequestMeta;
}

/**
 * Disable 2FA (sensitive change): requires current password + a valid
 * second factor, then wipes secret + codes and revokes ALL sessions —
 * the caller re-authenticates through the fresh (unenrolled) flow.
 */
export async function disableTwoFactor(input: DisableInput): Promise<void> {
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUnique({ where: { id: input.adminId } });
  if (!admin) throw unauthorized('Invalid credentials');
  if (!(await verifySecret(admin.passwordHash, input.password))) {
    throw unauthorized('Invalid credentials');
  }
  const method = await verifySecondFactor(input.adminId, input.code, input.meta);
  if (!method) throw unauthorized('Invalid verification code');

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({
      where: { id: input.adminId },
      data: { totpEnabled: false, totpSecretEncrypted: null, totpEnrolledAt: null },
    });
    await tx.adminRecoveryCode.deleteMany({ where: { adminId: input.adminId } });
    await logLoginEvent(tx, { adminId: input.adminId, event: 'TWO_FA_DISABLED', meta: input.meta });
  });
  await revokeAllSessions(input.adminId, input.meta);
}
