import { getPrisma } from '../../config/db.js';
import { getRedis } from '../../config/redis.js';
import { logger } from '../../config/logger.js';
import { ALL_PERMISSIONS, SUPER_ADMIN_ROLE_KEY, type PermissionKey } from './permissions.js';

const CACHE_PREFIX = 'rbac:perms:';
const CACHE_TTL_SECONDS = 600;

function cacheKey(adminId: string): string {
  return `${CACHE_PREFIX}${adminId}`;
}

interface CachedEntry {
  v: number;
  perms: string[];
}

async function readCache(adminId: string): Promise<CachedEntry | null> {
  try {
    const raw = await getRedis().get(cacheKey(adminId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    if (typeof parsed.v !== 'number' || !Array.isArray(parsed.perms)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(adminId: string, entry: CachedEntry): Promise<void> {
  try {
    await getRedis().set(cacheKey(adminId), JSON.stringify(entry), 'EX', CACHE_TTL_SECONDS);
  } catch {
    // Cache is best-effort — DB remains authoritative (PDF §11).
  }
}

async function resolveFromDb(adminId: string): Promise<{ perms: Set<string>; version: number }> {
  const prisma = getPrisma();
  const [admin, assignments] = await Promise.all([
    prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { permissionsVersion: true, status: true },
    }),
    prisma.adminRoleAssignment.findMany({
      where: {
        adminId,
        role: { status: 'ACTIVE' },
      },
      include: {
        role: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
      },
    }),
  ]);
  if (!admin) return { perms: new Set<string>(), version: 0 };

  const roleKeys = assignments.map((a) => a.role.key);
  if (roleKeys.includes(SUPER_ADMIN_ROLE_KEY)) {
    // Super Admin implies every ACTIVE permission in the DB catalog UNION
    // the compiled catalog, so panel-created permissions apply instantly
    // with no code change — and compiled guards never lose access when the
    // DB catalog is a partial subset (e.g. minimal test seeds).
    const rows = await prisma.permission.findMany({
      where: { status: 'ACTIVE' },
      select: { key: true },
    });
    return {
      perms: new Set<string>([...rows.map((r) => r.key), ...ALL_PERMISSIONS]),
      version: admin.permissionsVersion,
    };
  }
  const out = new Set<string>();
  for (const a of assignments) {
    for (const rp of a.role.permissions) {
      if (rp.permission.status === 'ACTIVE') out.add(rp.permission.key);
    }
  }
  return { perms: out, version: admin.permissionsVersion };
}

/**
 * Effective permissions for an admin, resolved server-side on every
 * authenticated request (PDF §4).
 *
 * DB is authoritative; Redis caches the set keyed by `permissionsVersion`
 * (PDF §13–14). A cheap PK lookup validates the version — the expensive
 * 3-table join runs only on miss/mismatch. Any Redis failure degrades to
 * direct DB resolution, never to denial or stale grant.
 */
export async function getEffectivePermissions(adminId: string): Promise<Set<string>> {
  const cached = await readCache(adminId);
  if (cached) {
    try {
      const admin = await getPrisma().adminUser.findUnique({
        where: { id: adminId },
        select: { permissionsVersion: true },
      });
      if (admin && admin.permissionsVersion === cached.v) {
        return new Set<string>(cached.perms);
      }
    } catch {
      // Fall through to DB resolution.
    }
  }
  const { perms, version } = await resolveFromDb(adminId);
  await writeCache(adminId, { v: version, perms: [...perms] });
  return perms;
}

export async function isSuperAdmin(adminId: string): Promise<boolean> {
  const prisma = getPrisma();
  const count = await prisma.adminRoleAssignment.count({
    where: { adminId, role: { key: SUPER_ADMIN_ROLE_KEY, status: 'ACTIVE' } },
  });
  return count > 0;
}

export function requirePermissionKey(value: string): PermissionKey {
  if ((ALL_PERMISSIONS as readonly string[]).includes(value)) return value as PermissionKey;
  throw new Error(`Unknown permission key: ${value}`);
}

/** Bump one admin's version + drop cache. Call inside/after the mutating tx. */
export async function invalidateAdminPermissions(adminId: string): Promise<void> {
  try {
    await getPrisma().adminUser.update({
      where: { id: adminId },
      data: { permissionsVersion: { increment: 1 } },
    });
  } catch (err: unknown) {
    logger.warn('invalidateAdminPermissions: version bump failed', {
      adminId,
      error: (err as Error).message,
    });
  }
  try {
    await getRedis().del(cacheKey(adminId));
  } catch {
    // Best-effort.
  }
}

/**
 * Invalidate every admin holding `roleId` (role perms/status changed).
 * Version bump is durable in Postgres; Redis DEL is best-effort — a missed
 * DEL is still safe because the version check rejects the stale entry.
 */
export async function invalidateRoleHolders(roleId: string): Promise<void> {
  const prisma = getPrisma();
  let adminIds: string[] = [];
  try {
    const rows = await prisma.adminRoleAssignment.findMany({
      where: { roleId },
      select: { adminId: true },
    });
    adminIds = [...new Set(rows.map((r) => r.adminId))];
  } catch (err: unknown) {
    logger.warn('invalidateRoleHolders: lookup failed', { roleId, error: (err as Error).message });
    return;
  }
  if (adminIds.length === 0) return;
  try {
    await prisma.adminUser.updateMany({
      where: { id: { in: adminIds } },
      data: { permissionsVersion: { increment: 1 } },
    });
  } catch (err: unknown) {
    logger.warn('invalidateRoleHolders: bump failed', { roleId, error: (err as Error).message });
  }
  try {
    const redis = getRedis();
    const pipe = redis.pipeline();
    for (const id of adminIds) pipe.del(cacheKey(id));
    await pipe.exec();
  } catch {
    // Version check covers missed DELs.
  }
}

/** Invalidate every admin whose effective set may include `permissionId`. */
export async function invalidatePermissionHolders(permissionId: string): Promise<void> {
  const prisma = getPrisma();
  try {
    const rows = await prisma.adminRoleAssignment.findMany({
      where: { role: { permissions: { some: { permissionId } } } },
      select: { adminId: true },
    });
    const adminIds = [...new Set(rows.map((r) => r.adminId))];
    if (adminIds.length === 0) return;
    await prisma.adminUser.updateMany({
      where: { id: { in: adminIds } },
      data: { permissionsVersion: { increment: 1 } },
    });
    try {
      const redis = getRedis();
      const pipe = redis.pipeline();
      for (const id of adminIds) pipe.del(cacheKey(id));
      await pipe.exec();
    } catch {
      // Version check covers missed DELs.
    }
  } catch (err: unknown) {
    logger.warn('invalidatePermissionHolders failed', {
      permissionId,
      error: (err as Error).message,
    });
  }
}
