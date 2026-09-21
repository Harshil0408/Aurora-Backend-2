/**
 * Canonical permission keys. Routes/services must reference these constants —
 * never inline strings — so renames break at compile time, not in prod.
 */
export const PERMISSIONS = {
  ADMIN_READ: 'admin.read',
  ADMIN_CREATE: 'admin.create',
  ADMIN_UPDATE: 'admin.update',
  ADMIN_SUSPEND: 'admin.suspend',
  ROLE_READ: 'role.read',
  ROLE_CREATE: 'role.create',
  ROLE_UPDATE: 'role.update',
  ROLE_ASSIGN: 'role.assign',
  AUDIT_READ: 'audit.read',
  SESSION_READ: 'session.read',
  SESSION_REVOKE: 'session.revoke',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly PermissionKey[] = Object.values(PERMISSIONS);

export const SUPER_ADMIN_ROLE_KEY = 'super_admin';
export const SUB_ADMIN_ROLE_KEY = 'sub_admin';
export const SUPPORT_ROLE_KEY = 'support';

/** Default grants for seeded (non-super-admin) roles. Super Admin implicitly holds ALL. */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly PermissionKey[]> = {
  [SUB_ADMIN_ROLE_KEY]: [
    PERMISSIONS.ADMIN_READ,
    PERMISSIONS.ADMIN_UPDATE,
    PERMISSIONS.ROLE_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.SESSION_READ,
    PERMISSIONS.SESSION_REVOKE,
  ],
  [SUPPORT_ROLE_KEY]: [PERMISSIONS.ADMIN_READ, PERMISSIONS.SESSION_READ],
};

export interface RoleSeed {
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
}

export const ROLE_SEEDS: readonly RoleSeed[] = [
  {
    key: SUPER_ADMIN_ROLE_KEY,
    name: 'Super Admin',
    description: 'Full platform access, including role and permission management.',
    isSystem: true,
  },
  {
    key: SUB_ADMIN_ROLE_KEY,
    name: 'Sub-Admin',
    description: 'Operational admin with explicitly assigned capabilities.',
    isSystem: true,
  },
  {
    key: SUPPORT_ROLE_KEY,
    name: 'Support Staff',
    description: 'Restricted read access for customer support functionality.',
    isSystem: true,
  },
];

/**
 * Pure permission check. Super Admin short-circuits (implicit all).
 * Used by middleware AND service-layer checks for sensitive operations.
 */
export function hasPermission(granted: ReadonlySet<string>, required: PermissionKey): boolean {
  if (granted.has(SUPER_ADMIN_ROLE_KEY)) return true;
  return granted.has(required);
}

/** Expand a set of role keys to effective permission keys (super admin → all). */
export function expandRolePermissions(roleKeys: readonly string[]): Set<PermissionKey> {
  const out = new Set<PermissionKey>();
  if (roleKeys.includes(SUPER_ADMIN_ROLE_KEY)) {
    for (const p of ALL_PERMISSIONS) out.add(p);
    return out;
  }
  for (const key of roleKeys) {
    const perms = DEFAULT_ROLE_PERMISSIONS[key];
    if (perms) for (const p of perms) out.add(p);
  }
  return out;
}
