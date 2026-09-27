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

export interface PermissionGroup {
  group: string;
  label: string;
  permissions: { key: PermissionKey; label: string; description: string }[];
}

/**
 * Grouped catalog backing the Roles & Permissions checkbox matrix UI.
 * Rows = roles, columns = permissions within each group. The UI renders
 * one section per group with a Select-all-per-group toggle.
 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    group: 'admins',
    label: 'Admins',
    permissions: [
      {
        key: PERMISSIONS.ADMIN_READ,
        label: 'View admins',
        description: 'List and view admin accounts',
      },
      {
        key: PERMISSIONS.ADMIN_CREATE,
        label: 'Create admins',
        description: 'Create new admin accounts',
      },
      {
        key: PERMISSIONS.ADMIN_UPDATE,
        label: 'Edit admins',
        description: 'Change status and edit admin accounts',
      },
      {
        key: PERMISSIONS.ADMIN_SUSPEND,
        label: 'Suspend admins',
        description: 'Suspend, disable, or reactivate admins',
      },
    ],
  },
  {
    group: 'roles',
    label: 'Roles',
    permissions: [
      {
        key: PERMISSIONS.ROLE_READ,
        label: 'View roles',
        description: 'List roles and their permissions',
      },
      {
        key: PERMISSIONS.ROLE_CREATE,
        label: 'Create roles',
        description: 'Create new roles (start with zero permissions)',
      },
      {
        key: PERMISSIONS.ROLE_UPDATE,
        label: 'Edit permissions',
        description: 'Assign or remove role permissions',
      },
      {
        key: PERMISSIONS.ROLE_ASSIGN,
        label: 'Assign roles',
        description: 'Grant or revoke roles on admins',
      },
    ],
  },
  {
    group: 'activity',
    label: 'Activity',
    permissions: [
      {
        key: PERMISSIONS.AUDIT_READ,
        label: 'View activity log',
        description: 'Read the admin audit trail',
      },
    ],
  },
  {
    group: 'sessions',
    label: 'Sessions',
    permissions: [
      { key: PERMISSIONS.SESSION_READ, label: 'View sessions', description: 'List admin sessions' },
      {
        key: PERMISSIONS.SESSION_REVOKE,
        label: 'Revoke sessions',
        description: 'Revoke any admin session',
      },
    ],
  },
];
