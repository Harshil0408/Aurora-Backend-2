/**
 * Store-domain permission catalog — the single source of truth for the
 * seller panel, deliberately SEPARATE from the platform `module.action`
 * catalog in `src/modules/rbac/permissions.ts`.
 *
 * Format is `resource:action` (e.g. `product:create`) so a store grant can
 * never be mistaken for a platform grant. Runtime authorization resolves
 * from `store_permissions`/`store_roles` tables; these constants exist so
 * `requireStoreAccess(PERM)` guards break at compile time on rename.
 */

export const STORE_PERMISSION_RE = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;

export function isValidStorePermissionKey(key: string): boolean {
  return key.length <= 128 && STORE_PERMISSION_RE.test(key);
}

export function splitStorePermissionKey(key: string): { resource: string; action: string } {
  const idx = key.indexOf(':');
  if (idx <= 0 || idx !== key.lastIndexOf(':')) {
    throw new Error(`Invalid store permission key (expected resource:action): ${key}`);
  }
  return { resource: key.slice(0, idx), action: key.slice(idx + 1) };
}

export const STORE_PERMISSIONS = {
  STORE_READ: 'store:read',
  STORE_UPDATE: 'store:update',
  STORE_DELETE: 'store:delete',
  STORE_TRANSFER: 'store:transfer',
  PRODUCT_CREATE: 'product:create',
  PRODUCT_READ: 'product:read',
  PRODUCT_UPDATE: 'product:update',
  PRODUCT_DELETE: 'product:delete',
  ORDER_READ: 'order:read',
  ORDER_UPDATE: 'order:update',
  ORDER_CANCEL: 'order:cancel',
  INVENTORY_READ: 'inventory:read',
  INVENTORY_UPDATE: 'inventory:update',
  CUSTOMER_READ: 'customer:read',
  CUSTOMER_UPDATE: 'customer:update',
  ANALYTICS_READ: 'analytics:read',
  STAFF_INVITE: 'staff:invite',
  STAFF_REMOVE: 'staff:remove',
  STAFF_UPDATE: 'staff:update',
  ROLE_READ: 'role:read',
  ROLE_CREATE: 'role:create',
  ROLE_UPDATE: 'role:update',
  ROLE_DELETE: 'role:delete',
  SETTINGS_READ: 'settings:read',
  SETTINGS_UPDATE: 'settings:update',
  BILLING_READ: 'billing:read',
  BILLING_UPDATE: 'billing:update',
} as const;

export type StorePermissionKey = (typeof STORE_PERMISSIONS)[keyof typeof STORE_PERMISSIONS];

export const ALL_STORE_PERMISSIONS: readonly StorePermissionKey[] =
  Object.values(STORE_PERMISSIONS);

export const STORE_OWNER_ROLE_KEY = 'owner';
export const STORE_ADMIN_ROLE_KEY = 'admin';
export const STORE_STAFF_ROLE_KEY = 'staff';

interface StorePermissionSeed {
  key: StorePermissionKey;
  resource: string;
  action: string;
  label: string;
  description: string;
}

function seed(key: StorePermissionKey, label: string, description: string): StorePermissionSeed {
  const { resource, action } = splitStorePermissionKey(key);
  return { key, resource, action, label, description };
}

/** Canonical seed rows — synced idempotently by prisma/seed.ts. */
export const STORE_PERMISSION_SEEDS: readonly StorePermissionSeed[] = [
  seed('store:read', 'View store', 'View store profile and status'),
  seed('store:update', 'Edit store', 'Edit store profile and settings'),
  seed('store:delete', 'Delete store', 'Close/delete the store (owner only)'),
  seed('store:transfer', 'Transfer ownership', 'Transfer store ownership (owner only)'),
  seed('product:create', 'Create products', 'Create products in this store'),
  seed('product:read', 'View products', 'View products in this store'),
  seed('product:update', 'Edit products', 'Edit products in this store'),
  seed('product:delete', 'Delete products', 'Delete products in this store'),
  seed('order:read', 'View orders', 'View orders in this store'),
  seed('order:update', 'Manage orders', 'Update/fulfill orders in this store'),
  seed('order:cancel', 'Cancel orders', 'Cancel orders in this store'),
  seed('inventory:read', 'View inventory', 'View inventory levels'),
  seed('inventory:update', 'Manage inventory', 'Adjust inventory levels'),
  seed('customer:read', 'View customers', 'View store customers'),
  seed('customer:update', 'Manage customers', 'Edit store customers'),
  seed('analytics:read', 'View analytics', 'View store analytics'),
  seed('staff:invite', 'Invite staff', 'Invite team members to the store'),
  seed('staff:remove', 'Remove staff', 'Remove team members from the store'),
  seed('staff:update', 'Manage staff', 'Change member roles'),
  seed('role:read', 'View roles', 'List store roles and permissions'),
  seed('role:create', 'Create roles', 'Create custom store roles'),
  seed('role:update', 'Edit roles', 'Change role permissions'),
  seed('role:delete', 'Delete roles', 'Delete custom store roles'),
  seed('settings:read', 'View settings', 'View store settings'),
  seed('settings:update', 'Edit settings', 'Edit store settings'),
  seed('billing:read', 'View billing', 'View plans and subscription'),
  seed('billing:update', 'Manage billing', 'Change plan / billing (owner-biased)'),
];

/**
 * Default grants for the three system roles created with every store.
 * OWNER holds every permission implicitly (checked via role key), so it is
 * listed here for seeding completeness — authorization treats owner as all.
 */
export const DEFAULT_STORE_ROLE_PERMISSIONS: Record<string, readonly StorePermissionKey[]> = {
  [STORE_OWNER_ROLE_KEY]: ALL_STORE_PERMISSIONS,
  [STORE_ADMIN_ROLE_KEY]: ALL_STORE_PERMISSIONS.filter(
    (p) => p !== STORE_PERMISSIONS.STORE_DELETE && p !== STORE_PERMISSIONS.STORE_TRANSFER,
  ),
  [STORE_STAFF_ROLE_KEY]: [
    STORE_PERMISSIONS.STORE_READ,
    STORE_PERMISSIONS.PRODUCT_READ,
    STORE_PERMISSIONS.ORDER_READ,
    STORE_PERMISSIONS.INVENTORY_READ,
    STORE_PERMISSIONS.CUSTOMER_READ,
    STORE_PERMISSIONS.ANALYTICS_READ,
    STORE_PERMISSIONS.SETTINGS_READ,
  ],
};

export interface StoreRoleSeed {
  key: string;
  name: string;
  description: string;
}

export const STORE_ROLE_SEEDS: readonly StoreRoleSeed[] = [
  {
    key: STORE_OWNER_ROLE_KEY,
    name: 'Owner',
    description: 'Full store control incl. billing and deletion.',
  },
  {
    key: STORE_ADMIN_ROLE_KEY,
    name: 'Admin',
    description: 'Manage catalog, orders and team. No deletion/transfer.',
  },
  { key: STORE_STAFF_ROLE_KEY, name: 'Staff', description: 'Read-mostly operational access.' },
];
