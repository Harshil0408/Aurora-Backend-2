import { z } from 'zod';

/** POST /admins — Admins screen: Create Admin modal. */
export const createAdminSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(12).max(128),
  roleKeys: z.array(z.string().min(1).max(64)).min(1).max(10),
});

/** PATCH /admins/:id/status — Admins screen: Change Status modal. */
export const adminStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']),
});

/** PUT /admins/:id/roles — Admins screen: Manage Roles modal. */
export const assignRolesSchema = z.object({
  roleKeys: z.array(z.string().min(1).max(64)).min(1).max(10),
});
