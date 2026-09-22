import { getPrisma } from '../../config/db.js';
import { ALL_PERMISSIONS, SUPER_ADMIN_ROLE_KEY, type PermissionKey } from './permissions.js';

/**
 * Effective permissions for an admin, resolved server-side on every
 * authenticated request. Super Admin implies ALL (never stored per-row,
 * so new permissions apply instantly). Admin traffic is low — no cache.
 */
export async function getEffectivePermissions(adminId: string): Promise<Set<string>> {
  const prisma = getPrisma();
  const assignments = await prisma.adminRoleAssignment.findMany({
    where: { adminId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });

  const roleKeys = assignments.map((a) => a.role.key);
  if (roleKeys.includes(SUPER_ADMIN_ROLE_KEY)) {
    return new Set<string>([...ALL_PERMISSIONS]);
  }
  const out = new Set<string>();
  for (const a of assignments) {
    for (const rp of a.role.permissions) out.add(rp.permission.key);
  }
  return out;
}

export async function isSuperAdmin(adminId: string): Promise<boolean> {
  const prisma = getPrisma();
  const count = await prisma.adminRoleAssignment.count({
    where: { adminId, role: { key: SUPER_ADMIN_ROLE_KEY } },
  });
  return count > 0;
}

export function requirePermissionKey(value: string): PermissionKey {
  if ((ALL_PERMISSIONS as readonly string[]).includes(value)) return value as PermissionKey;
  throw new Error(`Unknown permission key: ${value}`);
}
