import { getPrisma } from '../../../config/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../shared/utils/requestMeta.js';
import { isValidStorePermissionKey } from './store-permissions.js';
import { invalidateStoreRole } from '../stores/store-rbac.service.js';
import { recordStoreAudit } from '../activity/store-audit.service.js';
import type { CreateRoleInput, UpdateRoleInput } from './team.schemas.js';

const SYSTEM_PROTECTED = new Set(['owner', 'admin', 'staff']);

export async function listRoles(storeId: string) {
  const prisma = getPrisma();
  const roles = await prisma.storeRole.findMany({
    where: { storeId },
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { memberships: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return roles.map((r) => ({
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    status: r.status,
    memberCount: r._count.memberships,
    permissions: r.permissions.map((rp) => rp.permission.key).sort(),
  }));
}

export async function createRole(
  storeId: string,
  actorId: string,
  actorEmail: string | null,
  input: CreateRoleInput,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const existing = await prisma.storeRole.findUnique({
    where: { storeId_key: { storeId, key: input.key } },
  });
  if (existing) throw conflict('Role key already in use');

  const permissionKeys = input.permissionKeys ?? [];
  for (const key of permissionKeys) {
    if (!isValidStorePermissionKey(key)) throw badRequest(`Invalid permission key: ${key}`);
  }
  const perms = permissionKeys.length
    ? await prisma.storePermission.findMany({ where: { key: { in: permissionKeys } } })
    : [];
  if (perms.length !== permissionKeys.length) throw badRequest('Unknown permission key');

  const role = await prisma.$transaction(async (tx) => {
    const created = await tx.storeRole.create({
      data: {
        storeId,
        key: input.key,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        isSystem: false,
        status: 'ACTIVE',
      },
    });
    for (const p of perms) {
      await tx.storeRolePermission.create({
        data: { roleId: created.id, permissionId: p.id },
      });
    }
    await recordStoreAudit(tx, {
      storeId,
      actorId,
      actorEmail,
      action: 'role.created',
      resourceType: 'role',
      resourceId: created.id,
      metadata: { key: created.key, permissions: permissionKeys },
      meta,
    });
    return created;
  });
  return { key: role.key, name: role.name };
}

export async function updateRole(
  storeId: string,
  roleKey: string,
  actorId: string,
  actorEmail: string | null,
  input: UpdateRoleInput,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const role = await prisma.storeRole.findUnique({
    where: { storeId_key: { storeId, key: roleKey } },
  });
  if (!role) throw notFound('Role not found');
  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.storeRole.update({
      where: { id: role.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
      },
    });
    await recordStoreAudit(tx, {
      storeId,
      actorId,
      actorEmail,
      action: 'role.updated',
      resourceType: 'role',
      resourceId: role.id,
      meta,
    });
    return next;
  });
  await invalidateStoreRole(storeId, role.id);
  return { key: updated.key, name: updated.name };
}

export async function setRolePermissions(
  storeId: string,
  roleKey: string,
  actorId: string,
  actorEmail: string | null,
  permissionKeys: string[],
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const role = await prisma.storeRole.findUnique({
    where: { storeId_key: { storeId, key: roleKey } },
  });
  if (!role) throw notFound('Role not found');
  if (role.key === 'owner') throw forbidden('Owner role permissions are immutable');

  for (const key of permissionKeys) {
    if (!isValidStorePermissionKey(key)) throw badRequest(`Invalid permission key: ${key}`);
  }
  const perms = await prisma.storePermission.findMany({
    where: { key: { in: permissionKeys } },
  });
  if (perms.length !== new Set(permissionKeys).size) throw badRequest('Unknown permission key');

  await prisma.$transaction(async (tx) => {
    await tx.storeRolePermission.deleteMany({ where: { roleId: role.id } });
    for (const p of perms) {
      await tx.storeRolePermission.create({ data: { roleId: role.id, permissionId: p.id } });
    }
    await recordStoreAudit(tx, {
      storeId,
      actorId,
      actorEmail,
      action: 'role.permissions_updated',
      resourceType: 'role',
      resourceId: role.id,
      metadata: { key: role.key, permissions: permissionKeys },
      meta,
    });
  });
  await invalidateStoreRole(storeId, role.id);
  return { key: role.key, permissions: [...new Set(permissionKeys)].sort() };
}

export async function deleteRole(
  storeId: string,
  roleKey: string,
  actorId: string,
  actorEmail: string | null,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const role = await prisma.storeRole.findUnique({
    where: { storeId_key: { storeId, key: roleKey } },
    include: { _count: { select: { memberships: true, invitations: true } } },
  });
  if (!role) throw notFound('Role not found');
  if (SYSTEM_PROTECTED.has(role.key) || role.isSystem) {
    throw forbidden('System roles cannot be deleted');
  }
  if (role._count.memberships > 0 || role._count.invitations > 0) {
    throw conflict('Role is in use and cannot be deleted');
  }
  await prisma.$transaction(async (tx) => {
    await tx.storeRole.delete({ where: { id: role.id } });
    await recordStoreAudit(tx, {
      storeId,
      actorId,
      actorEmail,
      action: 'role.deleted',
      resourceType: 'role',
      resourceId: role.id,
      metadata: { key: role.key },
      meta,
    });
  });
  return { deleted: true };
}

export async function listPermissions() {
  const prisma = getPrisma();
  const rows = await prisma.storePermission.findMany({
    orderBy: [{ resource: 'asc' }, { action: 'asc' }],
  });
  const groups = new Map<
    string,
    { key: string; label: string | null; description: string | null }[]
  >();
  for (const r of rows) {
    const list = groups.get(r.resource) ?? [];
    list.push({ key: r.key, label: r.label, description: r.description });
    groups.set(r.resource, list);
  }
  return [...groups.entries()].map(([resource, permissions]) => ({ resource, permissions }));
}
