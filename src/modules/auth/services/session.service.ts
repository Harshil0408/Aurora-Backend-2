import { randomBytes } from 'node:crypto';
import { getPrisma } from '../../../config/db.js';
import { logger } from '../../../config/logger.js';
import { unauthorized } from '../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../shared/utils/requestMeta.js';
import { hashToken } from '../crypto/tokenHash.js';
import { generateRefreshToken, signAccessToken } from '../crypto/tokens.js';
import { getEffectivePermissions } from '../../rbac/rbac.service.js';
import { logLoginEvent } from './loginActivity.service.js';

export const REFRESH_COOKIE_NAME = 'admin_rt';
export const REFRESH_IDLE_MS = 12 * 60 * 60_000; // 12h sliding window
export const REFRESH_ABSOLUTE_MS = 7 * 24 * 60 * 60_000; // 7d family cap

export interface IssuedSession {
  accessToken: string;
  /** Raw refresh token — set as HttpOnly cookie by the controller. */
  refreshToken: string;
  expiresInSeconds: number;
}

interface IssueInput {
  adminId: string;
  permissions: string[];
  tokenVersion: number;
  meta: RequestMeta;
}

/** Create a fresh session family after full (password + 2FA) auth. */
export async function issueSession(input: IssueInput): Promise<IssuedSession> {
  const prisma = getPrisma();
  const refreshToken = generateRefreshToken();
  const now = new Date();

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.adminSession.create({
      data: {
        adminId: input.adminId,
        refreshTokenHash: hashToken(refreshToken),
        familyId: randomBytes(16).toString('hex'),
        ipAddress: input.meta.ipAddress ?? null,
        userAgent: input.meta.userAgent ?? null,
        expiresAt: new Date(now.getTime() + REFRESH_IDLE_MS),
      },
    });
    await logLoginEvent(tx, { adminId: input.adminId, event: 'SESSION_CREATED', meta: input.meta });
    return created;
  });

  return {
    accessToken: signAccessToken({
      sub: input.adminId,
      sid: session.id,
      tv: input.tokenVersion,
      perms: input.permissions,
    }),
    refreshToken,
    expiresInSeconds: 300,
  };
}

interface RefreshInput {
  presentedToken: string;
  meta: RequestMeta;
}

/**
 * Rotate a refresh token. Reuse of an already-rotated token = theft:
 * the whole family is revoked immediately (reuse detection).
 */
export async function rotateSession(input: RefreshInput): Promise<IssuedSession> {
  const prisma = getPrisma();
  const presentedHash = hashToken(input.presentedToken);

  const current = await prisma.adminSession.findUnique({
    where: { refreshTokenHash: presentedHash },
    include: { admin: true },
  });
  if (!current) throw unauthorized('Invalid session');

  // Reuse detection: token belongs to a rotated (dead) row — or a live row
  // whose family was already compromised.
  const familyCompromised = await prisma.adminSession.count({
    where: { familyId: current.familyId, revokeReason: 'reuse_detected' },
  });
  if (current.revokedAt !== null || familyCompromised > 0) {
    await prisma.adminSession.updateMany({
      where: { familyId: current.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'reuse_detected' },
    });
    logger.warn('Refresh token reuse detected — family revoked', {
      familyId: current.familyId,
      adminId: current.adminId,
      requestId: input.meta.requestId,
    });
    await logLoginEvent(prisma, {
      adminId: current.adminId,
      event: 'SESSION_REVOKED',
      meta: input.meta,
    });
    throw unauthorized('Invalid session');
  }

  if (current.expiresAt.getTime() <= Date.now()) throw unauthorized('Session expired');

  const admin = current.admin;
  if (admin.status !== 'ACTIVE') throw unauthorized('Invalid session');

  // Absolute lifetime cap per family.
  if (current.createdAt.getTime() + REFRESH_ABSOLUTE_MS <= Date.now()) {
    await prisma.adminSession.update({
      where: { id: current.id },
      data: { revokedAt: new Date(), revokeReason: 'expired' },
    });
    throw unauthorized('Session expired');
  }

  const refreshToken = generateRefreshToken();
  const now = new Date();
  const rotated = await prisma.$transaction(async (tx) => {
    await tx.adminSession.update({
      where: { id: current.id },
      data: { revokedAt: now, revokeReason: 'rotated' },
    });
    return tx.adminSession.create({
      data: {
        adminId: current.adminId,
        refreshTokenHash: hashToken(refreshToken),
        previousTokenHash: presentedHash,
        familyId: current.familyId,
        ipAddress: input.meta.ipAddress ?? null,
        userAgent: input.meta.userAgent ?? null,
        expiresAt: new Date(now.getTime() + REFRESH_IDLE_MS),
      },
    });
  });

  const perms = await getEffectivePermissions(current.adminId);

  return {
    accessToken: signAccessToken({
      sub: current.adminId,
      sid: rotated.id,
      tv: admin.tokenVersion,
      perms: [...perms],
    }),
    refreshToken,
    expiresInSeconds: 300,
  };
}

/** Revoke one session (owner or holder of session.revoke). */
export async function revokeSession(
  sessionId: string,
  adminId: string,
  meta: RequestMeta,
  reason = 'revoked',
): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.adminSession.updateMany({
      where: { id: sessionId, adminId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
    await logLoginEvent(tx, { adminId, event: 'SESSION_REVOKED', meta });
  });
}

/**
 * Global logout: revoke every session AND bump tokenVersion so all
 * outstanding access JWTs die immediately.
 */
export async function revokeAllSessions(adminId: string, meta: RequestMeta): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.adminSession.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'logout_all' },
    });
    await tx.adminUser.update({
      where: { id: adminId },
      data: { tokenVersion: { increment: 1 } },
    });
    await logLoginEvent(tx, { adminId, event: 'SESSION_REVOKED', meta });
  });
}

export interface ActiveSessionView {
  id: string;
  familyId: string;
  ipAddress: string | null;
  userAgent: string | null;
  lastUsedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  current: boolean;
}

export async function listActiveSessions(
  adminId: string,
  currentSessionId: string,
  page: number,
  limit: number,
): Promise<{ data: ActiveSessionView[]; total: number }> {
  const prisma = getPrisma();
  const [rows, total] = await Promise.all([
    prisma.adminSession.findMany({
      where: { adminId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.adminSession.count({
      where: { adminId, revokedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);
  return {
    data: rows.map((r) => ({
      id: r.id,
      familyId: r.familyId,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      current: r.id === currentSessionId,
    })),
    total,
  };
}
