import { notFound } from '../../../../shared/errors/AppError.js';
import { getPrisma } from '../../../../config/db.js';

export interface AdminProfile {
  id: string;
  email: string;
  status: string;
  twoFactor: {
    totpEnabled: boolean;
    emailOtpEnabled: boolean;
  };
  roles: string[];
  /** Effective permission keys, resolved server-side (super admin implies all). */
  permissions: string[];
  createdAt: Date;
}

/** Logged-in admin profile for the top bar, role badges, and 2FA settings UI. */
export async function getAdminProfile(
  adminId: string,
  permissions: ReadonlySet<string>,
): Promise<AdminProfile> {
  const prisma = getPrisma();
  const admin = await prisma.adminUser.findUnique({
    where: { id: adminId },
    include: { roles: { include: { role: true } } },
  });
  if (!admin) throw notFound('Admin not found');
  return {
    id: admin.id,
    email: admin.email,
    status: admin.status,
    twoFactor: {
      totpEnabled: admin.totpEnabled,
      emailOtpEnabled: admin.emailOtpEnabled,
    },
    roles: admin.roles.map((r) => r.role.key).sort(),
    permissions: [...permissions].sort(),
    createdAt: admin.createdAt,
  };
}
