import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import {
  PERMISSION_GROUPS,
  SUPER_ADMIN_ROLE_KEY,
  isValidPermissionKeyFormat,
  splitPermissionKey,
} from '../../../rbac/permissions.js';
import {
  getEffectivePermissions,
  invalidatePermissionHolders,
  invalidateRoleHolders,
  isSuperAdmin,
} from '../../../rbac/rbac.service.js';
import { recordAudit } from '../../../audit/audit.service.js';

export interface RoleView {
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  permissions: string[];
  permissionCount: number;
  assignedAdmins: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PermissionView {
  key: string;
  module: string;
  action: string;
  label: string | null;
  description: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  isSystem: boolean;
  roleCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function listRoles(includeInactive = true): Promise<RoleView[]> {
  const prisma = getPrisma();
  const roles = await prisma.adminRole.findMany({
    where: includeInactive ? {} : { status: 'ACTIVE' },
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { assignments: true } },
    },
    orderBy: { key: 'asc' },
  });
  return roles.map(toRoleView);
}

export async function getRoleByKey(roleKey: string): Promise<RoleView> {
  const prisma = getPrisma();
  const role = await prisma.adminRole.findUnique({
    where: { key: roleKey },
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { assignments: true } },
    },
  });
  if (!role) throw notFound('Role not found');
  return toRoleView(role);
}

interface CreateRoleInput {
  key: string;
  name: string;
  description?: string | undefined;
  permissionKeys?: string[] | undefined;
  actorId: string;
  meta: RequestMeta;
}

export async function createRole(input: CreateRoleInput): Promise<RoleView> {
  const prisma = getPrisma();
  const existing = await prisma.adminRole.findUnique({ where: { key: input.key } });
  if (existing) throw conflict('Role already exists');

  // House rule: omitted permissionKeys => new role starts with EVERY ACTIVE
  // catalog permission (trim afterwards via PUT/POST/DELETE). An explicit
  // array (even empty) is honored as-is for least-privilege creation.
  let permissionKeys = [...new Set(input.permissionKeys ?? [])];
  if (input.permissionKeys === undefined) {
    const active = await prisma.permission.findMany({
      where: { status: 'ACTIVE' },
      select: { key: true },
    });
    permissionKeys = active.map((p) => p.key);
  }
  for (const k of permissionKeys) {
    if (!isValidPermissionKeyFormat(k)) throw badRequest(`Invalid permission key: ${k}`);
  }
  await assertGrantable(input.actorId, permissionKeys);

  let permissionIds: string[] = [];
  if (permissionKeys.length > 0) {
    const rows = await prisma.permission.findMany({ where: { key: { in: permissionKeys } } });
    if (rows.length !== permissionKeys.length) throw badRequest('Unknown permission key');
    const inactive = rows.filter((r) => r.status !== 'ACTIVE');
    if (inactive.length > 0) {
      throw badRequest(`Cannot grant INACTIVE permission: ${inactive[0]?.key}`, {
        code: 'PERMISSION_INACTIVE',
      });
    }
    permissionIds = rows.map((r) => r.id);
  }

  const created = await prisma.$transaction(async (tx) => {
    const role = await tx.adminRole.create({
      data: { key: input.key, name: input.name, description: input.description ?? null },
    });
    if (permissionIds.length > 0) {
      await tx.adminRolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    }
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'role.create',
      resourceType: 'role',
      resourceId: input.key,
      after: { key: input.key, name: input.name, permissions: permissionKeys },
      meta: input.meta,
    });
    return role;
  });
  return getRoleByKey(created.key);
}

interface UpdateRoleInput {
  roleKey: string;
  name?: string | undefined;
  description?: string | null | undefined;
  actorId: string;
  actorIsSuperAdmin: boolean;
  meta: RequestMeta;
}

export async function updateRole(input: UpdateRoleInput): Promise<RoleView> {
  if (input.roleKey === SUPER_ADMIN_ROLE_KEY && !input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can modify the super_admin role');
  }
  if (input.name === undefined && input.description === undefined) {
    throw badRequest('Provide name and/or description to update');
  }
  const prisma = getPrisma();
  const role = await prisma.adminRole.findUnique({ where: { key: input.roleKey } });
  if (!role) throw notFound('Role not found');

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.adminRole.update({
      where: { key: input.roleKey },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'role.update',
      resourceType: 'role',
      resourceId: input.roleKey,
      before: { name: role.name, description: role.description },
      after: { name: next.name, description: next.description },
      meta: input.meta,
    });
    return next;
  });
  void updated;
  return getRoleByKey(input.roleKey);
}

interface CloneRoleInput {
  sourceKey: string;
  key: string;
  name: string;
  description?: string | undefined;
  actorId: string;
  meta: RequestMeta;
}

/** Clone a role — grants copied, status always starts ACTIVE, never system. */
export async function cloneRole(input: CloneRoleInput): Promise<RoleView> {
  const prisma = getPrisma();
  const source = await prisma.adminRole.findUnique({
    where: { key: input.sourceKey },
    include: { permissions: { include: { permission: true } } },
  });
  if (!source) throw notFound('Source role not found');
  const existing = await prisma.adminRole.findUnique({ where: { key: input.key } });
  if (existing) throw conflict('Role already exists');

  const permissionKeys = source.permissions
    .filter((p) => p.permission.status === 'ACTIVE')
    .map((p) => p.permission.key);
  await assertGrantable(input.actorId, permissionKeys);

  const created = await prisma.$transaction(async (tx) => {
    const role = await tx.adminRole.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description ?? source.description,
      },
    });
    const activeIds = source.permissions
      .filter((p) => p.permission.status === 'ACTIVE')
      .map((p) => p.permission.id);
    if (activeIds.length > 0) {
      await tx.adminRolePermission.createMany({
        data: activeIds.map((permissionId) => ({ roleId: role.id, permissionId })),
      });
    }
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'role.clone',
      resourceType: 'role',
      resourceId: input.key,
      before: { source: input.sourceKey },
      after: { key: input.key, name: input.name, permissions: permissionKeys },
      meta: input.meta,
    });
    return role;
  });
  return getRoleByKey(created.key);
}

interface RoleStatusInput {
  roleKey: string;
  status: 'ACTIVE' | 'INACTIVE';
  reason: string;
  actorId: string;
  actorIsSuperAdmin: boolean;
  meta: RequestMeta;
}

export async function setRoleStatus(input: RoleStatusInput): Promise<RoleView> {
  if (input.roleKey === SUPER_ADMIN_ROLE_KEY) {
    throw forbidden('The super_admin role cannot be deactivated', {
      code: 'SYSTEM_ROLE_IMMUTABLE',
    });
  }
  const prisma = getPrisma();
  const role = await prisma.adminRole.findUnique({ where: { key: input.roleKey } });
  if (!role) throw notFound('Role not found');
  if (role.isSystem && input.status === 'INACTIVE' && !input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can deactivate a system role');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.adminRole.update({
      where: { key: input.roleKey },
      data: { status: input.status },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: input.status === 'ACTIVE' ? 'role.activate' : 'role.deactivate',
      resourceType: 'role',
      resourceId: input.roleKey,
      before: { status: role.status },
      after: { status: input.status, reason: input.reason },
      meta: input.meta,
    });
    return next;
  });
  await invalidateRoleHolders(role.id);
  void updated;
  return getRoleByKey(input.roleKey);
}

interface DeleteRoleInput {
  roleKey: string;
  actorId: string;
  actorIsSuperAdmin: boolean;
  meta: RequestMeta;
}

export async function deleteRole(input: DeleteRoleInput): Promise<void> {
  const prisma = getPrisma();
  const role = await prisma.adminRole.findUnique({
    where: { key: input.roleKey },
    include: { _count: { select: { assignments: true } } },
  });
  if (!role) throw notFound('Role not found');
  if (role.isSystem || input.roleKey === SUPER_ADMIN_ROLE_KEY) {
    throw forbidden('System roles cannot be deleted', { code: 'SYSTEM_ROLE_IMMUTABLE' });
  }
  if (!input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can delete roles');
  }
  if (role._count.assignments > 0) {
    throw conflict('Unassign all admins before deleting this role', {
      code: 'ROLE_HAS_ASSIGNMENTS',
      assignedAdmins: role._count.assignments,
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.adminRolePermission.deleteMany({ where: { roleId: role.id } });
    await tx.adminRole.delete({ where: { id: role.id } });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'role.delete',
      resourceType: 'role',
      resourceId: input.roleKey,
      before: { key: role.key, name: role.name },
      meta: input.meta,
    });
  });
  await invalidateRoleHolders(role.id);
}

export async function listPermissionCatalog(): Promise<
  {
    group: string;
    label: string;
    permissions: {
      key: string;
      module: string;
      action: string;
      label: string;
      description: string | null;
      status: string;
      isSystem: boolean;
    }[];
  }[]
> {
  const prisma = getPrisma();
  const [rows, counts] = await Promise.all([
    prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] }),
    prisma.adminRolePermission.groupBy({ by: ['permissionId'], _count: { roleId: true } }),
  ]);
  void counts;
  if (rows.length === 0) {
    // Pre-seed fallback so the matrix renders before first seed run.
    return PERMISSION_GROUPS.map((g) => ({
      group: g.group,
      label: g.label,
      permissions: g.permissions.map((p) => {
        const { module, action } = splitPermissionKey(p.key);
        return {
          key: p.key,
          module,
          action,
          label: p.label,
          description: p.description,
          status: 'ACTIVE',
          isSystem: true,
        };
      }),
    }));
  }
  const labelByKey = new Map<string, string>();
  for (const g of PERMISSION_GROUPS) {
    for (const p of g.permissions) labelByKey.set(p.key, p.label);
  }
  const byModule = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byModule.get(r.module) ?? [];
    list.push(r);
    byModule.set(r.module, list);
  }
  return [...byModule.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([module, perms]) => ({
      group: module,
      label: module.charAt(0).toUpperCase() + module.slice(1),
      permissions: perms.map((p) => ({
        key: p.key,
        module: p.module,
        action: p.action,
        label: p.label ?? labelByKey.get(p.key) ?? p.action,
        description: p.description,
        status: p.status,
        isSystem: p.isSystem,
      })),
    }));
}

export async function listPermissionsFlat(
  status?: 'ACTIVE' | 'INACTIVE',
): Promise<PermissionView[]> {
  const prisma = getPrisma();
  const rows = await prisma.permission.findMany({
    where: status ? { status } : {},
    include: { _count: { select: { roles: true } } },
    orderBy: [{ module: 'asc' }, { action: 'asc' }],
  });
  return rows.map((p) => ({
    key: p.key,
    module: p.module,
    action: p.action,
    label: p.label,
    description: p.description,
    status: p.status,
    isSystem: p.isSystem,
    roleCount: p._count.roles,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));
}

interface CreatePermissionInput {
  key: string;
  label?: string | undefined;
  description?: string | undefined;
  actorId: string;
  actorIsSuperAdmin: boolean;
  meta: RequestMeta;
}

/**
 * Reserve a new module.action key. Super-Admin-only: the catalog is
 * code-defined and seeded — a key created here enforces nothing until a
 * developer wires a `requirePerm(...)` guard for it and deploys.
 */
export async function createPermission(input: CreatePermissionInput): Promise<PermissionView> {
  if (!input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can define new permission keys');
  }
  if (!isValidPermissionKeyFormat(input.key)) {
    throw badRequest('Key must be module.action (lowercase, e.g. session.revoke)');
  }
  const prisma = getPrisma();
  const existing = await prisma.permission.findUnique({ where: { key: input.key } });
  if (existing) throw conflict('Permission already exists');
  const { module, action } = splitPermissionKey(input.key);
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.permission.create({
      data: {
        key: input.key,
        module,
        action,
        label: input.label?.trim() || action,
        description: input.description ?? null,
      },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'permission.create',
      resourceType: 'permission',
      resourceId: input.key,
      after: { key: input.key, module, action },
      meta: input.meta,
    });
    return row;
  });
  return {
    key: created.key,
    module: created.module,
    action: created.action,
    label: created.label,
    description: created.description,
    status: created.status,
    isSystem: created.isSystem,
    roleCount: 0,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
}

interface UpdatePermissionInput {
  key: string;
  label?: string | null | undefined;
  description?: string | null | undefined;
  actorId: string;
  meta: RequestMeta;
}

export async function updatePermission(input: UpdatePermissionInput): Promise<PermissionView> {
  if (input.label === undefined && input.description === undefined) {
    throw badRequest('Provide label and/or description to update');
  }
  const prisma = getPrisma();
  const row = await prisma.permission.findUnique({ where: { key: input.key } });
  if (!row) throw notFound('Permission not found');
  const next = await prisma.$transaction(async (tx) => {
    const updated = await tx.permission.update({
      where: { key: input.key },
      data: {
        ...(input.label !== undefined ? { label: input.label?.trim() || null } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'permission.update',
      resourceType: 'permission',
      resourceId: input.key,
      before: { label: row.label, description: row.description },
      after: { label: updated.label, description: updated.description },
      meta: input.meta,
    });
    return updated;
  });
  const roleCount = await prisma.adminRolePermission.count({
    where: { permissionId: next.id },
  });
  return {
    key: next.key,
    module: next.module,
    action: next.action,
    label: next.label,
    description: next.description,
    status: next.status,
    isSystem: next.isSystem,
    roleCount,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
  };
}

interface PermissionStatusInput {
  key: string;
  status: 'ACTIVE' | 'INACTIVE';
  reason: string;
  actorId: string;
  actorIsSuperAdmin: boolean;
  meta: RequestMeta;
}

export async function setPermissionStatus(input: PermissionStatusInput): Promise<PermissionView> {
  const prisma = getPrisma();
  const row = await prisma.permission.findUnique({ where: { key: input.key } });
  if (!row) throw notFound('Permission not found');
  if (row.isSystem && input.status === 'INACTIVE' && !input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can disable a system permission');
  }
  const next = await prisma.$transaction(async (tx) => {
    const updated = await tx.permission.update({
      where: { key: input.key },
      data: { status: input.status },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: input.status === 'ACTIVE' ? 'permission.activate' : 'permission.deactivate',
      resourceType: 'permission',
      resourceId: input.key,
      before: { status: row.status },
      after: { status: input.status, reason: input.reason },
      meta: input.meta,
    });
    return updated;
  });
  // INACTIVE permissions stop authorizing immediately for every holder.
  await invalidatePermissionHolders(row.id);
  const roleCount = await prisma.adminRolePermission.count({
    where: { permissionId: next.id },
  });
  return {
    key: next.key,
    module: next.module,
    action: next.action,
    label: next.label,
    description: next.description,
    status: next.status,
    isSystem: next.isSystem,
    roleCount,
    createdAt: next.createdAt,
    updatedAt: next.updatedAt,
  };
}

interface DeletePermissionInput {
  key: string;
  actorId: string;
  actorIsSuperAdmin: boolean;
  meta: RequestMeta;
}

export async function deletePermission(input: DeletePermissionInput): Promise<void> {
  const prisma = getPrisma();
  const row = await prisma.permission.findUnique({
    where: { key: input.key },
    include: { _count: { select: { roles: true } } },
  });
  if (!row) throw notFound('Permission not found');
  if (row.isSystem) {
    throw forbidden('System permissions cannot be deleted — disable them instead', {
      code: 'SYSTEM_PERMISSION_IMMUTABLE',
    });
  }
  if (!input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can delete permissions');
  }
  if (row._count.roles > 0) {
    throw conflict('Remove this permission from all roles before deleting', {
      code: 'PERMISSION_GRANTED',
      roleCount: row._count.roles,
    });
  }
  await prisma.$transaction(async (tx) => {
    await tx.permission.delete({ where: { id: row.id } });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'permission.delete',
      resourceType: 'permission',
      resourceId: input.key,
      before: { key: row.key, module: row.module, action: row.action },
      meta: input.meta,
    });
  });
  await invalidatePermissionHolders(row.id);
}

interface RolePermsInput {
  roleKey: string;
  permissionKeys: string[];
  actorId: string;
  actorIsSuperAdmin: boolean;
  meta: RequestMeta;
}

export async function setRolePermissions(input: RolePermsInput): Promise<void> {
  if (input.roleKey === SUPER_ADMIN_ROLE_KEY && !input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can modify the super_admin role');
  }
  const prisma = getPrisma();
  const role = await prisma.adminRole.findUnique({ where: { key: input.roleKey } });
  if (!role) throw notFound('Role not found');

  const permissionKeys = [...new Set(input.permissionKeys)];
  for (const k of permissionKeys) {
    if (!isValidPermissionKeyFormat(k)) throw badRequest(`Invalid permission key: ${k}`);
  }
  // Privilege-escalation guard (PDF §12): a non-super admin can only grant
  // permissions they themselves hold. Never trust client-supplied grants.
  await assertGrantable(input.actorId, permissionKeys, input.actorIsSuperAdmin);

  const perms = await prisma.permission.findMany({
    where: { key: { in: permissionKeys } },
  });
  if (perms.length !== permissionKeys.length) throw badRequest('Unknown permission key');
  const inactive = perms.filter((p) => p.status !== 'ACTIVE');
  if (inactive.length > 0) {
    throw badRequest(`Cannot grant INACTIVE permission: ${inactive[0]?.key}`, {
      code: 'PERMISSION_INACTIVE',
    });
  }

  const before = (
    await prisma.adminRolePermission.findMany({
      where: { roleId: role.id },
      include: { permission: true },
    })
  ).map((p) => p.permission.key);

  await prisma.$transaction(async (tx) => {
    await tx.adminRolePermission.deleteMany({ where: { roleId: role.id } });
    if (perms.length > 0) {
      await tx.adminRolePermission.createMany({
        data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
      });
    }
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'role.update',
      resourceType: 'role',
      resourceId: input.roleKey,
      before: { permissions: before },
      after: { permissions: permissionKeys },
      meta: input.meta,
    });
  });
  // Versioned cache invalidation — holders see the new set on next request.
  await invalidateRoleHolders(role.id);
}

export interface ModifyRolePermissionsResult {
  added: string[];
  alreadyGranted: string[];
  removed: string[];
  permissions: string[];
  role: RoleView;
}

/**
 * Add permissions to a role without touching existing grants (idempotent).
 * Missing keys are created; already-granted keys are skipped.
 */
export async function addRolePermissions(
  input: RolePermsInput,
): Promise<ModifyRolePermissionsResult> {
  if (input.roleKey === SUPER_ADMIN_ROLE_KEY && !input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can modify the super_admin role');
  }
  const prisma = getPrisma();
  const role = await prisma.adminRole.findUnique({ where: { key: input.roleKey } });
  if (!role) throw notFound('Role not found');

  const permissionKeys = [...new Set(input.permissionKeys)];
  if (permissionKeys.length === 0) throw badRequest('Provide at least one permission key');
  for (const k of permissionKeys) {
    if (!isValidPermissionKeyFormat(k)) throw badRequest(`Invalid permission key: ${k}`);
  }
  await assertGrantable(input.actorId, permissionKeys, input.actorIsSuperAdmin);

  const perms = await prisma.permission.findMany({
    where: { key: { in: permissionKeys } },
  });
  if (perms.length !== permissionKeys.length) throw badRequest('Unknown permission key');
  const inactive = perms.filter((p) => p.status !== 'ACTIVE');
  if (inactive.length > 0) {
    throw badRequest(`Cannot grant INACTIVE permission: ${inactive[0]?.key}`, {
      code: 'PERMISSION_INACTIVE',
    });
  }

  const existing = await prisma.adminRolePermission.findMany({
    where: { roleId: role.id },
    include: { permission: true },
  });
  const existingKeys = new Set(existing.map((p) => p.permission.key));
  const toAdd = perms.filter((p) => !existingKeys.has(p.key));
  const alreadyGranted = permissionKeys.filter((k) => existingKeys.has(k)).sort();
  const addedKeys = toAdd.map((p) => p.key).sort();

  if (toAdd.length > 0) {
    const before = [...existingKeys].sort();
    await prisma.$transaction(async (tx) => {
      await tx.adminRolePermission.createMany({
        data: toAdd.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
      await recordAudit(tx, {
        actorId: input.actorId,
        action: 'role.permissions.add',
        resourceType: 'role',
        resourceId: input.roleKey,
        before: { permissions: before },
        after: { permissions: [...before, ...addedKeys].sort(), added: addedKeys },
        meta: input.meta,
      });
    });
    await invalidateRoleHolders(role.id);
  }

  const view = await getRoleByKey(input.roleKey);
  return {
    added: addedKeys,
    alreadyGranted,
    removed: [],
    permissions: view.permissions,
    role: view,
  };
}

/**
 * Remove permissions from a role without touching other grants (idempotent).
 * Keys the role does not hold are reported as `notGranted` via `alreadyGranted`.
 */
export async function removeRolePermissions(
  input: RolePermsInput,
): Promise<ModifyRolePermissionsResult> {
  if (input.roleKey === SUPER_ADMIN_ROLE_KEY && !input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can modify the super_admin role');
  }
  const prisma = getPrisma();
  const role = await prisma.adminRole.findUnique({ where: { key: input.roleKey } });
  if (!role) throw notFound('Role not found');

  const permissionKeys = [...new Set(input.permissionKeys)];
  if (permissionKeys.length === 0) throw badRequest('Provide at least one permission key');
  for (const k of permissionKeys) {
    if (!isValidPermissionKeyFormat(k)) throw badRequest(`Invalid permission key: ${k}`);
  }

  const perms = await prisma.permission.findMany({
    where: { key: { in: permissionKeys } },
  });
  if (perms.length !== permissionKeys.length) throw badRequest('Unknown permission key');

  const existing = await prisma.adminRolePermission.findMany({
    where: { roleId: role.id },
    include: { permission: true },
  });
  const existingByKey = new Map(existing.map((p) => [p.permission.key, p.permission.id]));
  const toRemove = perms.filter((p) => existingByKey.has(p.key));
  const removedKeys = toRemove.map((p) => p.key).sort();
  const notGranted = permissionKeys.filter((k) => !existingByKey.has(k)).sort();

  if (toRemove.length > 0) {
    const before = existing.map((p) => p.permission.key).sort();
    await prisma.$transaction(async (tx) => {
      await tx.adminRolePermission.deleteMany({
        where: {
          roleId: role.id,
          permissionId: { in: toRemove.map((p) => p.id) },
        },
      });
      await recordAudit(tx, {
        actorId: input.actorId,
        action: 'role.permissions.remove',
        resourceType: 'role',
        resourceId: input.roleKey,
        before: { permissions: before },
        after: {
          permissions: before.filter((k) => !removedKeys.includes(k)),
          removed: removedKeys,
        },
        meta: input.meta,
      });
    });
    await invalidateRoleHolders(role.id);
  }

  const view = await getRoleByKey(input.roleKey);
  return {
    added: [],
    alreadyGranted: notGranted,
    removed: removedKeys,
    permissions: view.permissions,
    role: view,
  };
}

/**
 * Least-privilege grant guard: unless the actor is a Super Admin, every
 * granted key must already be in the actor's own effective set (resolved
 * server-side — never from client claims).
 */
async function assertGrantable(
  actorId: string,
  permissionKeys: string[],
  actorIsSuperAdmin?: boolean,
): Promise<void> {
  if (permissionKeys.length === 0) return;
  const isSuper = actorIsSuperAdmin ?? (await isSuperAdmin(actorId));
  if (isSuper) return;
  const held = await getEffectivePermissions(actorId);
  const unheld = permissionKeys.filter((k) => !held.has(k));
  if (unheld.length > 0) {
    throw forbidden(`Cannot grant permission you do not hold: ${unheld[0]}`, {
      code: 'CANNOT_GRANT_UNHELD_PERMISSION',
      unheld,
    });
  }
}

type RoleWithPerms = {
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: Date;
  updatedAt: Date;
  permissions: { permission: { key: string } }[];
  _count?: { assignments: number };
};

function toRoleView(r: RoleWithPerms): RoleView {
  const permissions = r.permissions.map((p) => p.permission.key).sort();
  return {
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    status: r.status,
    permissions,
    permissionCount: permissions.length,
    assignedAdmins: r._count?.assignments ?? 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
