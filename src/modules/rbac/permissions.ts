/**
 * Canonical permission catalog — the single source of truth for key FORMAT
 * and seed data, NOT for runtime authorization.
 *
 * Runtime authorization is DB-driven: `getEffectivePermissions()` resolves
 * keys from `permissions`/`admin_roles` tables, so an admin can create a new
 * `module.action` permission through the panel and assign it to roles
 * without any code change. These constants exist so route guards
 * (`requirePerm(PERMISSIONS.ADMIN_READ)`) break at compile time on rename.
 *
 * Naming: `module.action` — lowercase, underscores allowed
 * (e.g. `session.revoke`, `audit.read`).
 *
 * The catalog lists ONLY implemented modules. When a new module ships,
 * its keys are added here + seeded — never invented from the panel.
 */

export const PERMISSION_KEY_RE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function isValidPermissionKeyFormat(key: string): boolean {
  return key.length <= 128 && PERMISSION_KEY_RE.test(key);
}

export function splitPermissionKey(key: string): { module: string; action: string } {
  const idx = key.indexOf('.');
  if (idx <= 0 || idx !== key.lastIndexOf('.')) {
    throw new Error(`Invalid permission key (expected module.action): ${key}`);
  }
  return { module: key.slice(0, idx), action: key.slice(idx + 1) };
}

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
  ATTRIBUTE_READ: 'attribute.read',
  ATTRIBUTE_CREATE: 'attribute.create',
  ATTRIBUTE_UPDATE: 'attribute.update',
  ATTRIBUTE_DELETE: 'attribute.delete',
  // NOTE: users/products/orders keys live here ONLY once those modules
  // ship. Do not pre-seed future modules — the catalog mirrors reality.
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
    PERMISSIONS.ATTRIBUTE_READ,
    PERMISSIONS.ATTRIBUTE_CREATE,
    PERMISSIONS.ATTRIBUTE_UPDATE,
  ],
  [SUPPORT_ROLE_KEY]: [
    PERMISSIONS.ADMIN_READ,
    PERMISSIONS.SESSION_READ,
    PERMISSIONS.ATTRIBUTE_READ,
  ],
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

export interface PermissionSeed {
  key: PermissionKey;
  module: string;
  action: string;
  label: string;
  description: string;
  isSystem: boolean;
}

function seed(
  key: PermissionKey,
  label: string,
  description: string,
  isSystem = true,
): PermissionSeed {
  const { module, action } = splitPermissionKey(key);
  return { key, module, action, label, description, isSystem };
}

/** Canonical seed rows — synced idempotently by prisma/seed.ts. */
export const PERMISSION_SEEDS: readonly PermissionSeed[] = [
  seed('admin.read', 'View admins', 'List and view admin accounts'),
  seed('admin.create', 'Create admins', 'Create new admin accounts'),
  seed('admin.update', 'Edit admins', 'Change status and edit admin accounts'),
  seed('admin.suspend', 'Suspend admins', 'Suspend, disable, or reactivate admins'),
  seed('role.read', 'View roles', 'List roles and their permissions'),
  seed('role.create', 'Create roles', 'Create new roles (start with zero permissions)'),
  seed('role.update', 'Edit permissions', 'Assign or remove role permissions'),
  seed('role.assign', 'Assign roles', 'Grant or revoke roles on admins'),
  seed('audit.read', 'View activity log', 'Read the admin audit trail'),
  seed('session.read', 'View sessions', 'List admin sessions'),
  seed('session.revoke', 'Revoke sessions', 'Revoke any admin session'),
  seed('attribute.read', 'View attributes', 'List global lookup attributes by type'),
  seed('attribute.create', 'Create attributes', 'Add global lookup attributes'),
  seed('attribute.update', 'Edit attributes', 'Edit global lookup attributes'),
  seed('attribute.delete', 'Delete attributes', 'Delete custom global attributes'),
];

export function hasPermission(granted: ReadonlySet<string>, required: string): boolean {
  if (granted.has(SUPER_ADMIN_ROLE_KEY)) return true;
  return granted.has(required);
}

/**
 * Expand seed-default role keys to permission keys (super admin → all).
 * Pure helper over the compiled defaults — runtime authorization instead
 * resolves from the DB (roles + statuses included).
 */
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
        description: 'Create new roles (start with all active permissions)',
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
  {
    group: 'attributes',
    label: 'Attributes',
    permissions: [
      {
        key: PERMISSIONS.ATTRIBUTE_READ,
        label: 'View attributes',
        description: 'List global lookup attributes by type',
      },
      {
        key: PERMISSIONS.ATTRIBUTE_CREATE,
        label: 'Create attributes',
        description: 'Add global lookup attributes',
      },
      {
        key: PERMISSIONS.ATTRIBUTE_UPDATE,
        label: 'Edit attributes',
        description: 'Edit global lookup attributes',
      },
      {
        key: PERMISSIONS.ATTRIBUTE_DELETE,
        label: 'Delete attributes',
        description: 'Delete custom global attributes',
      },
    ],
  },
];
