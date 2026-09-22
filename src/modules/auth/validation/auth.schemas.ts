import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(1, 'Password is required').max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const pendingTokenSchema = z.object({
  pendingToken: z.string().min(1),
});

export const totpCodeSchema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().min(1).max(32),
});

export const disableTwoFactorSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().min(1).max(32),
});

export const forgotPasswordSchema = z.object({
  email: z.email().max(255),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(12).max(128),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']),
});

export const assignRolesSchema = z.object({
  roleKeys: z.array(z.string().min(1).max(64)).min(1).max(10),
});

export const createAdminSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(12).max(128),
  roleKeys: z.array(z.string().min(1).max(64)).min(1).max(10),
});

export const updateRolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string().min(1).max(64)).max(50),
});

export const createRoleSchema = z.object({
  key: z.string().min(1).max(64),
  name: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
});
