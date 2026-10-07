import { getPrisma } from '../../../config/db.js';
import { conflict, unauthorized } from '../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../shared/utils/requestMeta.js';
import { hashSecret, verifySecret } from './crypto/password.js';
import { normalizeEmail } from './utils/email.js';
import type { RegisterInput, SellerLoginInput } from './seller-auth.schemas.js';
import { issueSellerSession } from './seller-session.service.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$R/U1uktF9yJeqkoaNa+05w$o/Ndl7DEm+P4vA5epKkIpP7ckSfi0Qk0CiXyaqBYvyE';

export async function registerSeller(input: RegisterInput, meta: RequestMeta) {
  const prisma = getPrisma();
  const emailNormalized = normalizeEmail(input.email);

  const existing = await prisma.sellerUser.findUnique({ where: { emailNormalized } });
  if (existing) throw conflict('Email already in use', { code: 'EMAIL_IN_USE' });

  const passwordHash = await hashSecret(input.password);
  const user = await prisma.sellerUser.create({
    data: {
      email: input.email.trim(),
      emailNormalized,
      name: input.name?.trim() || input.email.split('@')[0] || 'seller',
      passwordHash,
      status: 'ACTIVE',
      emailVerifiedAt: null,
    },
  });

  const issued = await issueSellerSession(user.id, user.tokenVersion, meta);
  return {
    user: { id: user.id, email: user.email, name: user.name, status: user.status },
    ...issued,
  };
}

export async function loginSeller(input: SellerLoginInput, meta: RequestMeta) {
  const prisma = getPrisma();
  const emailNormalized = normalizeEmail(input.email);

  const seller = await prisma.sellerUser.findUnique({ where: { emailNormalized } });
  const passwordOk = await verifySecret(seller?.passwordHash ?? DUMMY_HASH, input.password);

  if (!seller || !passwordOk) {
    if (seller) {
      const attempts = seller.failedLoginAttempts + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS && !seller.lockedUntil;
      await prisma.sellerUser.update({
        where: { id: seller.id },
        data: {
          failedLoginAttempts: attempts,
          ...(shouldLock ? { lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) } : {}),
        },
      });
    }
    throw unauthorized('Invalid email or password');
  }

  if (seller.status !== 'ACTIVE') throw unauthorized('Invalid email or password');
  if (seller.lockedUntil && seller.lockedUntil.getTime() > Date.now()) {
    throw unauthorized('Invalid email or password');
  }

  await prisma.sellerUser.update({
    where: { id: seller.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

  const issued = await issueSellerSession(seller.id, seller.tokenVersion, meta);
  return {
    user: { id: seller.id, email: seller.email, name: seller.name, status: seller.status },
    ...issued,
  };
}

export async function getSellerProfile(sellerId: string) {
  const prisma = getPrisma();
  const seller = await prisma.sellerUser.findUnique({
    where: { id: sellerId },
    include: {
      memberships: {
        where: { status: 'ACTIVE' },
        include: {
          store: { select: { id: true, name: true, slug: true, status: true } },
          role: true,
        },
      },
    },
  });
  if (!seller) throw unauthorized('Invalid session');
  return {
    id: seller.id,
    email: seller.email,
    name: seller.name,
    status: seller.status,
    createdAt: seller.createdAt,
    stores: seller.memberships.map((m) => ({
      storeId: m.storeId,
      storeName: m.store.name,
      slug: m.store.slug,
      storeStatus: m.store.status,
      roleKey: m.role.key,
      roleName: m.role.name,
      joinedAt: m.joinedAt,
    })),
  };
}
