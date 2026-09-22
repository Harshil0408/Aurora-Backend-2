import { getPrisma } from '../../../config/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../shared/utils/requestMeta.js';
import { hashSecret } from '../../auth/crypto/password.js';
import { normalizeEmail } from '../../auth/utils/email.js';
import { isSuperAdmin } from '../../rbac/rbac.service.js';
import { SUPER_ADMIN_ROLE_KEY } from '../../rbac/permissions.js';
import { recordAudit } from '../../audit/audit.service.js';

export interface CreateAdminInput {
  email: string;
  password: string;
  roleKeys: string[];
  actorId: string;
  actorIsSuperAdmin: boolean;
  meta: RequestMeta;
}

export interface AdminView {
  id: string;
  email: string;
  status: string;
  totpEnabled: boolean;
  roles: string[];
  createdAt: Date;
}

/**
 * Create an admin (ACTIVE, must enroll 2FA at first login).
 * Only a Super Admin may grant the super_admin role — enforced here,
 * not just in the route, so no other caller can escalate.
 */
export async function createAdmin(input: CreateAdminInput): Promise<AdminView> {
  if (input.roleKeys.includes(SUPER_ADMIN_ROLE_KEY) && !input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can grant the super_admin role');
  }
  const prisma = getPrisma();
  const emailNormalized = normalizeEmail(input.email);

  const roles = await prisma.adminRole.findMany({ where: { key: { in: input.roleKeys } } });
  if (roles.length !== input.roleKeys.length) throw badRequest('Unknown role key');
  const existing = await prisma.adminUser.findUnique({ where: { emailNormalized } });
  if (existing) throw conflict('Admin with this email already exists');

  const passwordHash = await hashSecret(input.password);
  return prisma.$transaction(async (tx) => {
    const admin = await tx.adminUser.create({
      data: {
        email: input.email.trim(),
        emailNormalized,
        passwordHash,
        status: 'ACTIVE',
      },
    });
    await tx.adminPasswordHistory.create({ data: { adminId: admin.id, passwordHash } });
    await tx.adminRoleAssignment.createMany({
      data: roles.map((r) => ({ adminId: admin.id, roleId: r.id, assignedBy: input.actorId })),
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'admin.create',
      resourceType: 'admin',
      resourceId: admin.id,
      after: { email: emailNormalized, roles: input.roleKeys },
      meta: input.meta,
    });
    return toView(
      admin.id,
      admin.email,
      admin.status,
      admin.totpEnabled,
      input.roleKeys,
      admin.createdAt,
    );
  });
}

export async function listAdmins(
  page: number,
  limit: number,
): Promise<{ data: AdminView[]; total: number }> {
  const prisma = getPrisma();
  const [rows, total] = await Promise.all([
    prisma.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { roles: { include: { role: true } } },
    }),
    prisma.adminUser.count(),
  ]);
  return {
    data: rows.map((a) =>
      toView(
        a.id,
        a.email,
        a.status,
        a.totpEnabled,
        a.roles.map((r) => r.role.key),
        a.createdAt,
      ),
    ),
    total,
  };
}

interface StatusInput {
  targetId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED';
  actorId: string;
  meta: RequestMeta;
}

/** Guards: never yourself; never disable the last super admin. */
export async function setAdminStatus(input: StatusInput): Promise<void> {
  if (input.targetId === input.actorId) throw badRequest('You cannot change your own status');
  const prisma = getPrisma();
  const target = await prisma.adminUser.findUnique({ where: { id: input.targetId } });
  if (!target) throw notFound('Admin not found');

  if (input.status !== 'ACTIVE' && (await isSuperAdmin(input.targetId))) {
    const remaining = await prisma.adminRoleAssignment.count({
      where: {
        role: { key: SUPER_ADMIN_ROLE_KEY },
        admin: { status: 'ACTIVE', id: { not: input.targetId } },
      },
    });
    if (remaining === 0) throw badRequest('Cannot suspend the last active Super Admin');
  }

  await prisma.$transaction(async (tx) => {
    await tx.adminUser.update({ where: { id: input.targetId }, data: { status: input.status } });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'admin.suspend',
      resourceType: 'admin',
      resourceId: input.targetId,
      before: { status: target.status },
      after: { status: input.status },
      meta: input.meta,
    });
  });
}

interface RolesInput {
  targetId: string;
  roleKeys: string[];
  actorId: string;
  actorIsSuperAdmin: boolean;
  meta: RequestMeta;
}

/**
 * Replace an admin's roles. Guards: super_admin grants need a super-admin
 * caller; you cannot strip your OWN super_admin role (self-lockout).
 */
export async function setAdminRoles(input: RolesInput): Promise<void> {
  if (input.roleKeys.includes(SUPER_ADMIN_ROLE_KEY) && !input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can grant the super_admin role');
  }
  if (
    input.targetId === input.actorId &&
    (await isSuperAdmin(input.actorId)) &&
    !input.roleKeys.includes(SUPER_ADMIN_ROLE_KEY)
  ) {
    throw badRequest('You cannot remove your own super_admin role');
  }
  const prisma = getPrisma();
  const target = await prisma.adminUser.findUnique({ where: { id: input.targetId } });
  if (!target) throw notFound('Admin not found');
  const roles = await prisma.adminRole.findMany({ where: { key: { in: input.roleKeys } } });
  if (roles.length !== input.roleKeys.length) throw badRequest('Unknown role key');

  const before = (
    await prisma.adminRoleAssignment.findMany({
      where: { adminId: input.targetId },
      include: { role: true },
    })
  ).map((a) => a.role.key);

  await prisma.$transaction(async (tx) => {
    await tx.adminRoleAssignment.deleteMany({ where: { adminId: input.targetId } });
    await tx.adminRoleAssignment.createMany({
      data: roles.map((r) => ({
        adminId: input.targetId,
        roleId: r.id,
        assignedBy: input.actorId,
      })),
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'role.assign',
      resourceType: 'admin',
      resourceId: input.targetId,
      before: { roles: before },
      after: { roles: input.roleKeys },
      meta: input.meta,
    });
  });
}

// --- Roles catalog ---

export async function listRoles(): Promise<{ key: string; name: string; permissions: string[] }[]> {
  const prisma = getPrisma();
  const roles = await prisma.adminRole.findMany({
    include: { permissions: { include: { permission: true } } },
    orderBy: { key: 'asc' },
  });
  return roles.map((r) => ({
    key: r.key,
    name: r.name,
    permissions: r.permissions.map((p) => p.permission.key),
  }));
}

interface CreateRoleInput {
  key: string;
  name: string;
  description?: string | undefined;
  actorId: string;
  meta: RequestMeta;
}

export async function createRole(input: CreateRoleInput): Promise<void> {
  const prisma = getPrisma();
  const existing = await prisma.adminRole.findUnique({ where: { key: input.key } });
  if (existing) throw conflict('Role already exists');
  await prisma.$transaction(async (tx) => {
    await tx.adminRole.create({
      data: { key: input.key, name: input.name, description: input.description ?? null },
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'role.create',
      resourceType: 'role',
      resourceId: input.key,
      after: { key: input.key, name: input.name },
      meta: input.meta,
    });
  });
}

interface RolePermsInput {
  roleKey: string;
  permissionKeys: string[];
  actorId: string;
  actorIsSuperAdmin: boolean;
  meta: RequestMeta;
}

/** Only Super Admins may touch the super_admin role's permissions. */
export async function setRolePermissions(input: RolePermsInput): Promise<void> {
  if (input.roleKey === SUPER_ADMIN_ROLE_KEY && !input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can modify the super_admin role');
  }
  const prisma = getPrisma();
  const role = await prisma.adminRole.findUnique({ where: { key: input.roleKey } });
  if (!role) throw notFound('Role not found');
  if (role.isSystem && input.roleKey !== SUPER_ADMIN_ROLE_KEY) {
    // System roles keep their identity; permission edits still allowed.
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

export async function queryAuditLog(
  page: number,
  limit: number,
  action?: string,
): Promise<{ data: unknown[]; total: number }> {
  const prisma = getPrisma();
  const where = action ? { action } : {};
  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.adminAuditLog.count({ where }),
  ]);
  return {
    data: rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      before: r.before,
      after: r.after,
      ipAddress: r.ipAddress,
      requestId: r.requestId,
      createdAt: r.createdAt,
    })),
    total,
  };
}

function toView(
  id: string,
  email: string,
  status: string,
  totpEnabled: boolean,
  roles: string[],
  createdAt: Date,
): AdminView {
  return { id, email, status, totpEnabled, roles, createdAt };
}
