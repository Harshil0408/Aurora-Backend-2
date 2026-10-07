import { createHash, randomBytes } from 'node:crypto';
import { getPrisma } from '../../../config/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../shared/utils/requestMeta.js';
import { normalizeEmail } from '../auth/utils/email.js';
import { STORE_OWNER_ROLE_KEY } from './store-permissions.js';
import { invalidateStoreMembership } from '../stores/store-rbac.service.js';
import { recordStoreAudit } from '../activity/store-audit.service.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function listMembers(storeId: string) {
  const prisma = getPrisma();
  const rows = await prisma.storeMembership.findMany({
    where: { storeId, status: { not: 'REMOVED' } },
    include: { user: { select: { id: true, email: true, name: true } }, role: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    roleKey: m.role.key,
    roleName: m.role.name,
    status: m.status,
    joinedAt: m.joinedAt,
  }));
}

export async function inviteMember(
  storeId: string,
  actorId: string,
  actorEmail: string | null,
  email: string,
  roleKey: string,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  if (roleKey === STORE_OWNER_ROLE_KEY) {
    throw forbidden('Ownership transfers through the transfer flow, not invitations');
  }
  const role = await prisma.storeRole.findUnique({
    where: { storeId_key: { storeId, key: roleKey } },
  });
  if (!role || role.status !== 'ACTIVE') throw badRequest('Unknown or inactive role');

  const emailNormalized = normalizeEmail(email);
  const existingMember = await prisma.storeMembership.findFirst({
    where: { storeId, user: { emailNormalized }, status: { not: 'REMOVED' } },
  });
  if (existingMember) throw conflict('User is already a member of this store');

  await prisma.storeInvitation.updateMany({
    where: { storeId, emailNormalized, status: 'PENDING' },
    data: { status: 'REVOKED' },
  });

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.storeInvitation.create({
      data: {
        storeId,
        email: email.trim(),
        emailNormalized,
        roleId: role.id,
        tokenHash: hashInviteToken(token),
        status: 'PENDING',
        expiresAt,
        invitedById: actorId,
      },
    });
    await recordStoreAudit(tx, {
      storeId,
      actorId,
      actorEmail,
      action: 'staff.invited',
      resourceType: 'invitation',
      resourceId: created.id,
      metadata: { email: emailNormalized, roleKey },
      meta,
    });
    return created;
  });

  // Phase 1: log-only delivery (mail infra is log-only unless SMTP is set).
  // The raw token is returned once so the owner can share it; only the
  // hash is persisted.
  return { invitationId: invitation.id, email: invitation.email, roleKey, expiresAt, token };
}

export async function listInvitations(storeId: string) {
  const prisma = getPrisma();
  const rows = await prisma.storeInvitation.findMany({
    where: { storeId },
    include: { role: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    roleKey: r.role.key,
    status: r.status,
    expiresAt: r.expiresAt,
    acceptedAt: r.acceptedAt,
    createdAt: r.createdAt,
  }));
}

export async function revokeInvitation(
  storeId: string,
  invitationId: string,
  actorId: string,
  actorEmail: string | null,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const invitation = await prisma.storeInvitation.findFirst({
    where: { id: invitationId, storeId },
  });
  if (!invitation) throw notFound('Invitation not found');
  if (invitation.status !== 'PENDING') throw badRequest('Invitation is no longer pending');

  await prisma.$transaction(async (tx) => {
    await tx.storeInvitation.update({
      where: { id: invitation.id },
      data: { status: 'REVOKED' },
    });
    await recordStoreAudit(tx, {
      storeId,
      actorId,
      actorEmail,
      action: 'staff.invite_revoked',
      resourceType: 'invitation',
      resourceId: invitation.id,
      meta,
    });
  });
  return { revoked: true };
}

/** Accept by raw token. Requires auth; the logged-in email must match. */
export async function acceptInvitation(sellerId: string, token: string, meta: RequestMeta) {
  const prisma = getPrisma();
  const invitation = await prisma.storeInvitation.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    include: { store: true, role: true },
  });
  if (!invitation) throw notFound('Invitation not found');
  if (invitation.status !== 'PENDING') throw badRequest('Invitation is no longer pending');
  if (invitation.expiresAt.getTime() <= Date.now()) {
    await prisma.storeInvitation.update({
      where: { id: invitation.id },
      data: { status: 'EXPIRED' },
    });
    throw badRequest('Invitation has expired');
  }

  const seller = await prisma.sellerUser.findUnique({ where: { id: sellerId } });
  if (!seller || normalizeEmail(seller.email) !== invitation.emailNormalized) {
    throw forbidden('This invitation was sent to a different email address');
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.storeMembership.findUnique({
      where: { storeId_userId: { storeId: invitation.storeId, userId: sellerId } },
    });
    let membershipId: string;
    if (existing) {
      const updated = await tx.storeMembership.update({
        where: { id: existing.id },
        data: { roleId: invitation.roleId, status: 'ACTIVE' },
      });
      membershipId = updated.id;
    } else {
      const created = await tx.storeMembership.create({
        data: {
          storeId: invitation.storeId,
          userId: sellerId,
          roleId: invitation.roleId,
          status: 'ACTIVE',
          invitedBy: invitation.invitedById,
        },
      });
      membershipId = created.id;
    }
    await tx.storeInvitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    await recordStoreAudit(tx, {
      storeId: invitation.storeId,
      actorId: sellerId,
      actorEmail: seller.email,
      action: 'staff.joined',
      resourceType: 'membership',
      resourceId: membershipId,
      metadata: { roleKey: invitation.role.key },
      meta,
    });
    return { storeId: invitation.storeId, membershipId };
  });

  await invalidateStoreMembership(invitation.storeId, sellerId);
  return result;
}

export async function updateMemberRole(
  storeId: string,
  targetUserId: string,
  actorId: string,
  actorEmail: string | null,
  roleKey: string,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  if (targetUserId === actorId) throw badRequest('Use the transfer flow to change your own role');
  const role = await prisma.storeRole.findUnique({
    where: { storeId_key: { storeId, key: roleKey } },
  });
  if (!role || role.status !== 'ACTIVE') throw badRequest('Unknown or inactive role');
  if (role.key === STORE_OWNER_ROLE_KEY) {
    throw forbidden('Ownership transfers through the transfer flow, not role assignment');
  }
  const membership = await prisma.storeMembership.findUnique({
    where: { storeId_userId: { storeId, userId: targetUserId } },
    include: { role: true },
  });
  if (!membership || membership.status === 'REMOVED') throw notFound('Member not found');
  if (membership.role.key === STORE_OWNER_ROLE_KEY) {
    throw forbidden('The owner role cannot be changed here');
  }

  await prisma.$transaction(async (tx) => {
    await tx.storeMembership.update({
      where: { id: membership.id },
      data: { roleId: role.id },
    });
    await recordStoreAudit(tx, {
      storeId,
      actorId,
      actorEmail,
      action: 'staff.role_changed',
      resourceType: 'membership',
      resourceId: membership.id,
      metadata: { from: membership.role.key, to: role.key },
      meta,
    });
  });
  await invalidateStoreMembership(storeId, targetUserId);
  return { userId: targetUserId, roleKey: role.key };
}

export async function removeMember(
  storeId: string,
  targetUserId: string,
  actorId: string,
  actorEmail: string | null,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  if (targetUserId === actorId) throw badRequest('You cannot remove yourself');
  const membership = await prisma.storeMembership.findUnique({
    where: { storeId_userId: { storeId, userId: targetUserId } },
    include: { role: true },
  });
  if (!membership || membership.status === 'REMOVED') throw notFound('Member not found');
  if (membership.role.key === STORE_OWNER_ROLE_KEY) throw forbidden('The owner cannot be removed');

  await prisma.$transaction(async (tx) => {
    await tx.storeMembership.update({
      where: { id: membership.id },
      data: { status: 'REMOVED' },
    });
    await recordStoreAudit(tx, {
      storeId,
      actorId,
      actorEmail,
      action: 'staff.removed',
      resourceType: 'membership',
      resourceId: membership.id,
      metadata: { roleKey: membership.role.key },
      meta,
    });
  });
  await invalidateStoreMembership(storeId, targetUserId);
  return { removed: true };
}
