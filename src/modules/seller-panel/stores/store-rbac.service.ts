import { getPrisma } from '../../../config/db.js';
import { getRedis } from '../../../config/redis.js';
import { STORE_OWNER_ROLE_KEY } from '../team/store-permissions.js';

const CACHE_PREFIX = 'store:membership:';
const CACHE_TTL_SECONDS = 300;

function cacheKey(storeId: string, userId: string): string {
  return `${CACHE_PREFIX}${storeId}:${userId}`;
}

export interface StoreMembershipContext {
  membershipId: string;
  roleId: string;
  roleKey: string;
  isOwner: boolean;
  permissions: Set<string>;
}

/**
 * Resolve a seller's effective store permissions. DB is authoritative;
 * Redis caches the membership→role→permissions set and is invalidated on
 * role/permission/membership change. Owner implies ALL permissions.
 */
export async function getStorePermissions(
  storeId: string,
  userId: string,
): Promise<StoreMembershipContext | null> {
  try {
    const raw = await getRedis().get(cacheKey(storeId, userId));
    if (raw) {
      const parsed = JSON.parse(raw) as {
        membershipId: string;
        roleId: string;
        roleKey: string;
        perms: string[];
      };
      if (parsed && Array.isArray(parsed.perms)) {
        return {
          membershipId: parsed.membershipId,
          roleId: parsed.roleId,
          roleKey: parsed.roleKey,
          isOwner: parsed.roleKey === STORE_OWNER_ROLE_KEY,
          permissions: new Set(parsed.perms),
        };
      }
    }
  } catch {
    // Cache miss → DB.
  }

  const prisma = getPrisma();
  const membership = await prisma.storeMembership.findUnique({
    where: { storeId_userId: { storeId, userId } },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
      store: { select: { status: true, deletedAt: true } },
    },
  });
  if (!membership || membership.status !== 'ACTIVE') return null;
  if (membership.role.status !== 'ACTIVE') return null;
  if (membership.store.deletedAt) return null;

  const perms = new Set<string>();
  if (membership.role.key === STORE_OWNER_ROLE_KEY) {
    const all = await prisma.storePermission.findMany({ select: { key: true } });
    for (const p of all) perms.add(p.key);
  } else {
    for (const rp of membership.role.permissions) perms.add(rp.permission.key);
  }

  const ctx: StoreMembershipContext = {
    membershipId: membership.id,
    roleId: membership.roleId,
    roleKey: membership.role.key,
    isOwner: membership.role.key === STORE_OWNER_ROLE_KEY,
    permissions: perms,
  };

  try {
    await getRedis().set(
      cacheKey(storeId, userId),
      JSON.stringify({
        membershipId: ctx.membershipId,
        roleId: ctx.roleId,
        roleKey: ctx.roleKey,
        perms: [...perms],
      }),
      'EX',
      CACHE_TTL_SECONDS,
    );
  } catch {
    // Best-effort.
  }
  return ctx;
}

export async function invalidateStoreMembership(storeId: string, userId: string): Promise<void> {
  try {
    await getRedis().del(cacheKey(storeId, userId));
  } catch {
    // Best-effort.
  }
}

/** Invalidate every cached membership bound to a role (perms/role changed). */
export async function invalidateStoreRole(storeId: string, roleId: string): Promise<void> {
  const prisma = getPrisma();
  try {
    const rows = await prisma.storeMembership.findMany({
      where: { storeId, roleId },
      select: { userId: true },
    });
    if (rows.length === 0) return;
    const redis = getRedis();
    const pipe = redis.pipeline();
    for (const r of rows) pipe.del(cacheKey(storeId, r.userId));
    await pipe.exec();
  } catch {
    // Best-effort; TTL bounds staleness.
  }
}
