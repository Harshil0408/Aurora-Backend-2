import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSION_GROUPS, SUPER_ADMIN_ROLE_KEY } from '../../../rbac/permissions.js';
import { recordAudit } from '../../../audit/audit.service.js';

export interface RoleView {
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  permissionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function listRoles(): Promise<RoleView[]> {
  const prisma = getPrisma();
  const roles = await prisma.adminRole.findMany({
    include: { permissions: { include: { permission: true } } },
    orderBy: { key: 'asc' },
  });
  return roles.map(toRoleView);
}

export async function getRoleByKey(roleKey: string): Promise<RoleView> {
  const prisma = getPrisma();
  const role = await prisma.adminRole.findUnique({
    where: { key: roleKey },
    include: { permissions: { include: { permission: true } } },
  });
  if (!role) throw notFound('Role not found');
  return toRoleView(role);
}

interface CreateRoleInput {
  key: string;
  name: string;
  description?: string | undefined;
  actorId: string;
  meta: RequestMeta;
}

export async function createRole(input: CreateRoleInput): Promise<RoleView> {
  const prisma = getPrisma();
  const existing = await prisma.adminRole.findUnique({ where: { key: input.key } });
  if (existing) throw conflict('Role already exists');
  const created = await prisma.$transaction(async (tx) => {
    const role = await tx.adminRole.create({
      data: { key: input.key, name: input.name, description: input.description ?? null },
      include: { permissions: { include: { permission: true } } },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'role.create',
      resourceType: 'role',
      resourceId: input.key,
      after: { key: input.key, name: input.name },
      meta: input.meta,
    });
    return role;
  });
  return toRoleView(created);
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
      include: { permissions: { include: { permission: true } } },
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
  return toRoleView(updated);
}

export async function listPermissionCatalog(): Promise<
  {
    group: string;
    label: string;
    permissions: { key: string; label: string; description: string | null }[];
  }[]
> {
  const prisma = getPrisma();
  const rows = await prisma.permission.findMany({ orderBy: { key: 'asc' } });
  const known = new Map(rows.map((p) => [p.key, p.description]));
  return PERMISSION_GROUPS.map((g) => ({
    group: g.group,
    label: g.label,
    permissions: g.permissions.map((p) => ({
      key: p.key,
      label: p.label,
      description: known.has(p.key) ? (known.get(p.key) ?? null) : p.description,
    })),
  }));
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
  if (role.isSystem && input.roleKey !== SUPER_ADMIN_ROLE_KEY) {
  }
  const perms = await prisma.permission.findMany({
    where: { key: { in: input.permissionKeys } },
  });
  if (perms.length !== input.permissionKeys.length) throw badRequest('Unknown permission key');

  const before = (
    await prisma.adminRolePermission.findMany({
      where: { roleId: role.id },
      include: { permission: true },
    })
  ).map((p) => p.permission.key);

  await prisma.$transaction(async (tx) => {
    await tx.adminRolePermission.deleteMany({ where: { roleId: role.id } });
    await tx.adminRolePermission.createMany({
      data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'role.update',
      resourceType: 'role',
      resourceId: input.roleKey,
      before: { permissions: before },
      after: { permissions: input.permissionKeys },
      meta: input.meta,
    });
  });
}

type RoleWithPerms = {
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: { permission: { key: string } }[];
};

function toRoleView(r: RoleWithPerms): RoleView {
  const permissions = r.permissions.map((p) => p.permission.key).sort();
  return {
    key: r.key,
    name: r.name,
    description: r.description,
    isSystem: r.isSystem,
    permissions,
    permissionCount: permissions.length,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
