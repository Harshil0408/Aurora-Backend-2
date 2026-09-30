import { randomBytes } from 'node:crypto';
import { getPrisma } from '../../../../config/db.js';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  unprocessable,
} from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import type { Prisma } from '../../../../generated/prisma/client.js';
import { hashSecret } from '../../auth/crypto/password.js';
import { normalizeEmail } from '../../auth/utils/email.js';
import { isSuperAdmin } from '../../../rbac/rbac.service.js';
import { SUPER_ADMIN_ROLE_KEY } from '../../../rbac/permissions.js';
import { recordAudit } from '../../../audit/audit.service.js';
import { logLoginEvent } from '../../auth/services/loginActivity.service.js';

export type AdminStatusKey = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface RoleRef {
  key: string;
  name: string;
}

export interface AdminListItem {
  id: string;
  email: string;
  name: string;
  status: AdminStatusKey;
  roles: RoleRef[];
  twoFactor: { enabled: boolean; methods: Array<'totp' | 'email_otp'> };
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  isSelf: boolean;
  isLastActiveSuperAdmin: boolean;
}

export interface AdminRecentActivity {
  id: string;
  action: string;
  actorEmail: string | null;
  ipAddress: string | null;
  createdAt: Date;
}

export interface AdminDetail extends AdminListItem {
  activeSessionsCount: number;
  recentActivity: AdminRecentActivity[];
}

export interface AdminCounts {
  total: number;
  active: number;
  suspended: number;
  disabled: number;
}

export interface AdminsSummary extends AdminCounts {
  needsAttention: number;
  twoFactorEnabled: number;
}

const SORTABLE_FIELDS = new Set([
  'createdAt',
  'email',
  'name',
  'status',
  'lastLoginAt',
  'updatedAt',
]);

/**
 * Accept the canonical UPPERCASE status plus the Capitalized display form
 * the Admins UI uses (`Active`/`Suspended`/`Disabled`). DB + all other
 * endpoints stay UPPERCASE — the frontend formats for display.
 */
export function normalizeStatus(value: string): AdminStatusKey {
  const upper = value.trim().toUpperCase();
  if (upper === 'ACTIVE' || upper === 'SUSPENDED' || upper === 'DISABLED') return upper;
  throw badRequest(`Unknown status: ${value}`, { code: 'INVALID_STATUS', field: 'status' });
}

function parseSort(raw: string | undefined): Prisma.AdminUserOrderByWithRelationInput {
  const value = raw?.trim() || 'createdAt:desc';
  const [fieldRaw, dirRaw] = value.split(':');
  const field = (fieldRaw ?? 'createdAt').trim();
  const dir = (dirRaw ?? 'desc').trim().toLowerCase();
  if (!SORTABLE_FIELDS.has(field)) {
    throw badRequest(`Unknown sort field: ${field}`, { code: 'INVALID_SORT', field: 'sort' });
  }
  if (dir !== 'asc' && dir !== 'desc') {
    throw badRequest(`Unknown sort direction: ${dirRaw}`, { code: 'INVALID_SORT', field: 'sort' });
  }
  return { [field]: dir };
}

export function displayName(email: string, name: string | null): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const local = email.split('@')[0] ?? email;
  return local || email;
}

function toRoleRefs(assignments: Array<{ role: { key: string; name: string } }>): RoleRef[] {
  return assignments
    .map((a) => ({ key: a.role.key, name: a.role.name }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

function toTwoFactor(totpEnabled: boolean, emailOtpEnabled: boolean): AdminListItem['twoFactor'] {
  const methods: Array<'totp' | 'email_otp'> = [];
  if (totpEnabled) methods.push('totp');
  if (emailOtpEnabled) methods.push('email_otp');
  return { enabled: methods.length > 0, methods };
}

type AdminRow = {
  id: string;
  email: string;
  name: string | null;
  status: AdminStatusKey;
  totpEnabled: boolean;
  emailOtpEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  roles: Array<{ role: { key: string; name: string } }>;
};

function toListItem(row: AdminRow, actorId: string, lastActiveSaId: string | null): AdminListItem {
  return {
    id: row.id,
    email: row.email,
    name: displayName(row.email, row.name),
    status: row.status,
    roles: toRoleRefs(row.roles),
    twoFactor: toTwoFactor(row.totpEnabled, row.emailOtpEnabled),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
    isSelf: row.id === actorId,
    isLastActiveSuperAdmin: lastActiveSaId !== null && row.id === lastActiveSaId,
  };
}

/** The single active Super Admin id when exactly one exists, else null. */
async function getLastActiveSuperAdminId(): Promise<string | null> {
  const prisma = getPrisma();
  const rows = await prisma.adminRoleAssignment.findMany({
    where: { role: { key: SUPER_ADMIN_ROLE_KEY }, admin: { status: 'ACTIVE' } },
    select: { adminId: true },
  });
  return rows.length === 1 && rows[0] ? rows[0].adminId : null;
}

export interface ListAdminsInput {
  page: number;
  limit: number;
  status?: string | undefined;
  role?: string | undefined;
  search?: string | undefined;
  sort?: string | undefined;
  actorId: string;
}

export async function listAdmins(input: ListAdminsInput): Promise<{
  data: AdminListItem[];
  total: number;
  counts: AdminCounts;
  twoFactorEnabled: number;
}> {
  const prisma = getPrisma();
  const where: Prisma.AdminUserWhereInput = {};
  if (input.status !== undefined && input.status !== '') {
    where['status'] = normalizeStatus(input.status);
  }
  if (input.role !== undefined && input.role !== '') {
    where['roles'] = { some: { role: { key: input.role.trim() } } };
  }
  const search = input.search?.trim();
  if (search) {
    where['OR'] = [
      { email: { contains: search, mode: 'insensitive' } },
      { emailNormalized: { contains: search.toLowerCase() } },
      { name: { contains: search, mode: 'insensitive' } },
    ];
  }

  const orderBy = parseSort(input.sort);
  const [rows, total, active, suspended, disabled, countTotal, twoFactorEnabled, lastActiveSaId] =
    await Promise.all([
      prisma.adminUser.findMany({
        where,
        orderBy,
        skip: (input.page - 1) * input.limit,
        take: input.limit,
        include: { roles: { include: { role: true } } },
      }),
      prisma.adminUser.count({ where }),
      prisma.adminUser.count({ where: { status: 'ACTIVE' } }),
      prisma.adminUser.count({ where: { status: 'SUSPENDED' } }),
      prisma.adminUser.count({ where: { status: 'DISABLED' } }),
      prisma.adminUser.count(),
      prisma.adminUser.count({
        where: { OR: [{ totpEnabled: true }, { emailOtpEnabled: true }] },
      }),
      getLastActiveSuperAdminId(),
    ]);

  const counts: AdminCounts = { total: countTotal, active, suspended, disabled };

  return {
    data: rows.map((a) =>
      toListItem(
        {
          id: a.id,
          email: a.email,
          name: a.name,
          status: a.status as AdminStatusKey,
          totpEnabled: a.totpEnabled,
          emailOtpEnabled: a.emailOtpEnabled,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          lastLoginAt: a.lastLoginAt,
          roles: a.roles,
        },
        input.actorId,
        lastActiveSaId,
      ),
    ),
    total,
    counts,
    twoFactorEnabled,
  };
}

export async function getAdminsSummary(): Promise<AdminsSummary> {
  const prisma = getPrisma();
  const [total, active, suspended, disabled, twoFactorEnabled] = await Promise.all([
    prisma.adminUser.count(),
    prisma.adminUser.count({ where: { status: 'ACTIVE' } }),
    prisma.adminUser.count({ where: { status: 'SUSPENDED' } }),
    prisma.adminUser.count({ where: { status: 'DISABLED' } }),
    prisma.adminUser.count({
      where: { OR: [{ totpEnabled: true }, { emailOtpEnabled: true }] },
    }),
  ]);
  return {
    total,
    active,
    suspended,
    disabled,
    needsAttention: suspended + disabled,
    twoFactorEnabled,
  };
}

export async function getAdminDetail(id: string, actorId: string): Promise<AdminDetail> {
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUnique({
    where: { id },
    include: { roles: { include: { role: true } } },
  });
  if (!admin) throw notFound('Admin not found', { code: 'ADMIN_NOT_FOUND' });

  const now = new Date();
  const [activeSessionsCount, auditRows, lastActiveSaId] = await Promise.all([
    prisma.adminSession.count({
      where: { adminId: id, revokedAt: null, expiresAt: { gt: now } },
    }),
    prisma.adminAuditLog.findMany({
      where: { resourceType: 'admin', resourceId: id },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    getLastActiveSuperAdminId(),
  ]);

  const actorIds = [...new Set(auditRows.map((r) => r.actorId).filter((v): v is string => !!v))];
  const actors =
    actorIds.length > 0
      ? await prisma.adminUser.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, email: true },
        })
      : [];
  const emailById = new Map(actors.map((a) => [a.id, a.email]));
  const recentActivity: AdminRecentActivity[] = auditRows.map((r) => ({
    id: r.id,
    action: r.action,
    actorEmail: r.actorId ? (emailById.get(r.actorId) ?? null) : null,
    ipAddress: r.ipAddress,
    createdAt: r.createdAt,
  }));

  return {
    ...toListItem(
      {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        status: admin.status as AdminStatusKey,
        totpEnabled: admin.totpEnabled,
        emailOtpEnabled: admin.emailOtpEnabled,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
        lastLoginAt: admin.lastLoginAt,
        roles: admin.roles,
      },
      actorId,
      lastActiveSaId,
    ),
    activeSessionsCount,
    recentActivity,
  };
}

const COMMON_PASSWORDS = new Set([
  'password',
  'password123',
  'password123!',
  'password1',
  'admin123',
  'admin123!',
  'admin123456',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'letmein123',
  'welcome123',
  'changeme123',
  'temp-password',
  'temppassword123',
]);

function assertPasswordAcceptable(password: string, field: string): void {
  if (password.length < 12) {
    throw unprocessable('Password must be at least 12 characters', {
      code: 'TOO_SHORT',
      field,
    });
  }
  if (password.length > 128) {
    throw unprocessable('Password must be at most 128 characters', {
      code: 'TOO_LONG',
      field,
    });
  }
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    throw unprocessable('Password is too common', { code: 'TOO_WEAK', field });
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw unprocessable('Password must include letters and numbers', {
      code: 'TOO_WEAK',
      field,
    });
  }
}

function assertValidName(name: string | undefined): string | null {
  if (name === undefined) return null;
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    throw unprocessable('Name must be at least 2 characters', {
      code: 'TOO_SHORT',
      field: 'name',
    });
  }
  if (trimmed.length > 255) {
    throw unprocessable('Name must be at most 255 characters', {
      code: 'TOO_LONG',
      field: 'name',
    });
  }
  return trimmed;
}

export interface CreateAdminInput {
  email: string;
  name?: string | undefined;
  /** `password` (legacy) or `tempPassword` (Admins UI) — validated identically. */
  password: string;
  roleKeys: string[];
  actorId: string;
  actorIsSuperAdmin: boolean;
  meta: RequestMeta;
}

export interface CreatedAdminView {
  id: string;
  email: string;
  name: string;
  status: AdminStatusKey;
  roles: RoleRef[];
  twoFactor: { enabled: boolean; methods: Array<'totp' | 'email_otp'> };
  inviteSent: boolean;
  createdAt: Date;
}

/**
 * Create an admin (ACTIVE, must enroll 2FA at first login).
 * Only a Super Admin may grant the super_admin role — enforced here,
 * not just in the route, so no other caller can escalate.
 */
export async function createAdmin(input: CreateAdminInput): Promise<CreatedAdminView> {
  if (input.roleKeys.includes(SUPER_ADMIN_ROLE_KEY) && !input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can grant the super_admin role', {
      code: 'SUPER_ADMIN_GRANT_FORBIDDEN',
      requiredRole: SUPER_ADMIN_ROLE_KEY,
    });
  }
  assertPasswordAcceptable(input.password, 'tempPassword');
  const name = assertValidName(input.name);
  if (!input.roleKeys || input.roleKeys.length === 0) {
    throw unprocessable('Select at least one role', { code: 'ROLE_REQUIRED', field: 'roleKeys' });
  }
  if (input.roleKeys.length > 10) {
    throw unprocessable('Too many roles (max 10)', { code: 'TOO_MANY', field: 'roleKeys' });
  }

  const prisma = getPrisma();
  const emailNormalized = normalizeEmail(input.email);

  const roles = await prisma.adminRole.findMany({ where: { key: { in: input.roleKeys } } });
  if (roles.length !== input.roleKeys.length) {
    const known = new Set(roles.map((r) => r.key));
    throw unprocessable('Unknown role key', {
      code: 'UNKNOWN_ROLE',
      field: 'roleKeys',
      invalidKeys: input.roleKeys.filter((k) => !known.has(k)),
    });
  }
  const existing = await prisma.adminUser.findUnique({ where: { emailNormalized } });
  if (existing) {
    throw conflict('An admin with this email already exists', {
      code: 'EMAIL_IN_USE',
      field: 'email',
    });
  }

  const email = input.email.trim();
  const resolvedName = name ?? displayName(email, null);
  const passwordHash = await hashSecret(input.password);
  const created = await prisma.$transaction(async (tx) => {
    const admin = await tx.adminUser.create({
      data: {
        email,
        emailNormalized,
        name: resolvedName,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
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
      after: { email: emailNormalized, name: resolvedName, roles: input.roleKeys },
      meta: input.meta,
    });
    return admin;
  });

  // Invite mail is log-only unless SMTP is configured; the UI toast
  // differentiates via this flag. ( Phase 1: creation only, no mail send. )
  return {
    id: created.id,
    email: created.email,
    name: displayName(created.email, created.name),
    status: 'ACTIVE',
    roles: roles
      .map((r) => ({ key: r.key, name: r.name }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    twoFactor: { enabled: false, methods: [] },
    inviteSent: false,
    createdAt: created.createdAt,
  };
}

interface StatusInput {
  targetId: string;
  status: AdminStatusKey;
  reason: string;
  actorId: string;
  meta: RequestMeta;
}

function assertValidReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    throw unprocessable('A reason of at least 3 characters is required', {
      code: 'TOO_SHORT',
      field: 'reason',
    });
  }
  if (trimmed.length > 500) {
    throw unprocessable('Reason must be at most 500 characters', {
      code: 'TOO_LONG',
      field: 'reason',
    });
  }
  return trimmed;
}

export async function setAdminStatus(
  input: StatusInput,
): Promise<{ id: string; status: AdminStatusKey; updatedAt: Date }> {
  if (input.targetId === input.actorId) {
    throw forbidden('You cannot change your own status', { code: 'CANNOT_CHANGE_OWN_STATUS' });
  }
  const reason = assertValidReason(input.reason);
  const prisma = getPrisma();
  const target = await prisma.adminUser.findUnique({
    where: { id: input.targetId },
    include: { roles: { include: { role: true } } },
  });
  if (!target) throw notFound('Admin not found', { code: 'ADMIN_NOT_FOUND' });

  const targetIsSuperAdmin = target.roles.some((a) => a.role.key === SUPER_ADMIN_ROLE_KEY);
  if (target.status === 'ACTIVE' && input.status !== 'ACTIVE' && targetIsSuperAdmin) {
    const remaining = await prisma.adminRoleAssignment.count({
      where: {
        role: { key: SUPER_ADMIN_ROLE_KEY },
        admin: { status: 'ACTIVE', id: { not: input.targetId } },
      },
    });
    if (remaining === 0) {
      throw conflict('Cannot deactivate the last active Super Admin', {
        code: 'LAST_SUPER_ADMIN',
      });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.adminUser.update({
      where: { id: input.targetId },
      data: { status: input.status },
    });
    if (input.status === 'DISABLED') {
      // Disabled kills every session now (suspended merely blocks sign-in).
      await tx.adminSession.updateMany({
        where: { adminId: input.targetId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'admin_disabled' },
      });
      await tx.adminUser.update({
        where: { id: input.targetId },
        data: { tokenVersion: { increment: 1 } },
      });
      await logLoginEvent(tx, {
        adminId: input.targetId,
        event: 'SESSION_REVOKED',
        meta: input.meta,
      });
    }
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'admin.suspend',
      resourceType: 'admin',
      resourceId: input.targetId,
      before: { status: target.status },
      after: { status: input.status, reason },
      meta: input.meta,
    });
    return next;
  });
  return { id: updated.id, status: updated.status as AdminStatusKey, updatedAt: updated.updatedAt };
}

interface RolesInput {
  targetId: string;
  roleKeys: string[];
  actorId: string;
  actorIsSuperAdmin: boolean;
  meta: RequestMeta;
}

export async function setAdminRoles(input: RolesInput): Promise<{
  roles: RoleRef[];
  added: string[];
  removed: string[];
}> {
  if (input.roleKeys.includes(SUPER_ADMIN_ROLE_KEY) && !input.actorIsSuperAdmin) {
    throw forbidden('Only a Super Admin can grant the super_admin role', {
      code: 'SUPER_ADMIN_GRANT_FORBIDDEN',
      requiredRole: SUPER_ADMIN_ROLE_KEY,
    });
  }
  if (
    input.targetId === input.actorId &&
    (await isSuperAdmin(input.actorId)) &&
    !input.roleKeys.includes(SUPER_ADMIN_ROLE_KEY)
  ) {
    throw forbidden('You cannot remove your own super_admin role', {
      code: 'CANNOT_REMOVE_OWN_SUPER_ADMIN',
    });
  }
  if (!input.roleKeys || input.roleKeys.length === 0) {
    throw unprocessable('Select at least one role', { code: 'ROLE_REQUIRED', field: 'roleKeys' });
  }

  const prisma = getPrisma();
  const target = await prisma.adminUser.findUnique({
    where: { id: input.targetId },
    include: { roles: { include: { role: true } } },
  });
  if (!target) throw notFound('Admin not found', { code: 'ADMIN_NOT_FOUND' });
  const roles = await prisma.adminRole.findMany({ where: { key: { in: input.roleKeys } } });
  if (roles.length !== input.roleKeys.length) {
    const known = new Set(roles.map((r) => r.key));
    throw unprocessable('Unknown role key', {
      code: 'UNKNOWN_ROLE',
      field: 'roleKeys',
      invalidKeys: input.roleKeys.filter((k) => !known.has(k)),
    });
  }

  const before = target.roles.map((a) => a.role.key).sort();
  const targetIsActiveSuperAdmin =
    target.status === 'ACTIVE' && before.includes(SUPER_ADMIN_ROLE_KEY);
  if (targetIsActiveSuperAdmin && !input.roleKeys.includes(SUPER_ADMIN_ROLE_KEY)) {
    const remaining = await prisma.adminRoleAssignment.count({
      where: {
        role: { key: SUPER_ADMIN_ROLE_KEY },
        admin: { status: 'ACTIVE', id: { not: input.targetId } },
      },
    });
    if (remaining === 0) {
      throw conflict('Cannot remove the last active Super Admin', { code: 'LAST_SUPER_ADMIN' });
    }
  }

  const nextKeys = [...input.roleKeys].sort();
  const beforeSet = new Set(before);
  const nextSet = new Set(nextKeys);
  const added = nextKeys.filter((k) => !beforeSet.has(k));
  const removed = before.filter((k) => !nextSet.has(k));

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
      after: { roles: nextKeys },
      meta: input.meta,
    });
  });

  return {
    roles: roles
      .map((r) => ({ key: r.key, name: r.name }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    added,
    removed,
  };
}

interface RevokeSessionsInput {
  targetId: string;
  actorId: string;
  meta: RequestMeta;
}

/**
 * Revoke ALL sessions for one admin (cross-admin variant of logout-all).
 * Never touches the caller's own cookie/session — only the target's rows
 * plus a tokenVersion bump so outstanding JWTs die too.
 */
export async function revokeAdminSessions(
  input: RevokeSessionsInput,
): Promise<{ revokedCount: number }> {
  const prisma = getPrisma();
  const target = await prisma.adminUser.findUnique({ where: { id: input.targetId } });
  if (!target) throw notFound('Admin not found', { code: 'ADMIN_NOT_FOUND' });

  return prisma.$transaction(async (tx) => {
    const res = await tx.adminSession.updateMany({
      where: { adminId: input.targetId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: 'admin_revoked' },
    });
    await tx.adminUser.update({
      where: { id: input.targetId },
      data: { tokenVersion: { increment: 1 } },
    });
    await logLoginEvent(tx, {
      adminId: input.targetId,
      event: 'SESSION_REVOKED',
      meta: input.meta,
    });
    await recordAudit(tx, {
      actorId: input.actorId,
      action: 'session.revoke',
      resourceType: 'admin',
      resourceId: input.targetId,
      after: { revokedCount: res.count },
      meta: input.meta,
    });
    return { revokedCount: res.count };
  });
}

export async function checkEmailAvailability(email: string): Promise<{ available: boolean }> {
  const prisma = getPrisma();
  const emailNormalized = normalizeEmail(email);
  const existing = await prisma.adminUser.findUnique({ where: { emailNormalized } });
  return { available: !existing };
}

/**
 * Server-side temp password for the Create dialog's Generate button.
 * 16 chars from CSPRNG with guaranteed upper/lower/digit/symbol mix,
 * always passing the creation policy (min 12 + letters + numbers).
 */
export function generateTempPassword(): { password: string } {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '-_!@#$%^&*';
  const all = lower + upper + digits + symbols;
  const pick = (alphabet: string): string => {
    const idx = randomBytes(1)[0]! % alphabet.length;
    return alphabet[idx]!;
  };
  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  for (let i = 0; i < 12; i++) chars.push(pick(all));
  // Fisher–Yates with CSPRNG so required classes aren't positional.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }
  return { password: chars.join('') };
}
