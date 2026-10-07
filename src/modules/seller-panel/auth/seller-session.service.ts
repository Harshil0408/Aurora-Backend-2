import { randomBytes } from 'node:crypto';
import { getPrisma } from '../../../config/db.js';
import { logger } from '../../../config/logger.js';
import { unauthorized } from '../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../shared/utils/requestMeta.js';
import { hashToken } from './crypto/tokenHash.js';
import { generateRefreshToken, signSellerAccessToken } from './crypto/tokens.js';

export const SELLER_REFRESH_COOKIE = 'seller_rt';
export const REFRESH_IDLE_MS = 12 * 60 * 60_000;
export const REFRESH_ABSOLUTE_MS = 7 * 24 * 60 * 60_000;

export interface IssuedSellerSession {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export async function issueSellerSession(
  sellerId: string,
  tokenVersion: number,
  meta: RequestMeta,
): Promise<IssuedSellerSession> {
  const prisma = getPrisma();
  const refreshToken = generateRefreshToken();
  const now = new Date();

  const session = await prisma.$transaction(async (tx) => {
    const created = await tx.sellerSession.create({
      data: {
        sellerId,
        refreshTokenHash: hashToken(refreshToken),
        familyId: randomBytes(16).toString('hex'),
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        expiresAt: new Date(now.getTime() + REFRESH_IDLE_MS),
      },
    });
    await tx.sellerUser.update({
      where: { id: sellerId },
      data: { lastLoginAt: now },
    });
    return created;
  });

  return {
    accessToken: signSellerAccessToken({ sub: sellerId, sid: session.id, tv: tokenVersion }),
    refreshToken,
    expiresInSeconds: 300,
  };
}

export async function rotateSellerSession(
  presentedToken: string,
  meta: RequestMeta,
): Promise<IssuedSellerSession> {
  const prisma = getPrisma();
  const presentedHash = hashToken(presentedToken);

  const current = await prisma.sellerSession.findUnique({
    where: { refreshTokenHash: presentedHash },
    include: { seller: true },
  });
  if (!current) throw unauthorized('Invalid session');

  const familyCompromised = await prisma.sellerSession.count({
    where: { familyId: current.familyId, revokeReason: 'reuse_detected' },
  });
  if (current.revokedAt !== null || familyCompromised > 0) {
    await prisma.sellerSession.updateMany({
      where: { familyId: current.familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'reuse_detected' },
    });
    logger.warn('Seller refresh reuse detected — family revoked', { familyId: current.familyId });
    throw unauthorized('Invalid session');
  }

  if (current.expiresAt.getTime() <= Date.now()) throw unauthorized('Session expired');
  if (current.seller.status !== 'ACTIVE') throw unauthorized('Invalid session');
  if (current.createdAt.getTime() + REFRESH_ABSOLUTE_MS <= Date.now()) {
    await prisma.sellerSession.update({
      where: { id: current.id },
      data: { revokedAt: new Date(), revokeReason: 'expired' },
    });
    throw unauthorized('Session expired');
  }

  const refreshToken = generateRefreshToken();
  const now = new Date();
  const rotated = await prisma.$transaction(async (tx) => {
    await tx.sellerSession.update({
      where: { id: current.id },
      data: { revokedAt: now, revokeReason: 'rotated' },
    });
    return tx.sellerSession.create({
      data: {
        sellerId: current.sellerId,
        refreshTokenHash: hashToken(refreshToken),
        previousTokenHash: presentedHash,
        familyId: current.familyId,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
        expiresAt: new Date(now.getTime() + REFRESH_IDLE_MS),
      },
    });
  });

  return {
    accessToken: signSellerAccessToken({
      sub: current.sellerId,
      sid: rotated.id,
      tv: current.seller.tokenVersion,
    }),
    refreshToken,
    expiresInSeconds: 300,
  };
}

export async function revokeSellerSession(sessionId: string, sellerId: string): Promise<void> {
  await getPrisma().sellerSession.updateMany({
    where: { id: sessionId, sellerId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: 'revoked' },
  });
}

export async function revokeAllSellerSessions(sellerId: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.sellerSession.updateMany({
      where: { sellerId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'logout_all' },
    });
    await tx.sellerUser.update({
      where: { id: sellerId },
      data: { tokenVersion: { increment: 1 } },
    });
  });
}

export async function listSellerSessions(sellerId: string, page: number, limit: number) {
  const prisma = getPrisma();
  const where = { sellerId, revokedAt: null, expiresAt: { gt: new Date() } };
  const [rows, total] = await Promise.all([
    prisma.sellerSession.findMany({
      where,
      orderBy: { lastUsedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.sellerSession.count({ where }),
  ]);
  return {
    data: rows.map((r) => ({
      id: r.id,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    })),
    total,
  };
}
