import { z } from 'zod';


export const createAdminSchema = z.object({
  email: z.email().max(255),
  name: z.string().max(255).optional(),
  password: z.string().min(1).max(128).optional(),
  tempPassword: z.string().min(1).max(128).optional(),
  roleKeys: z.array(z.string().min(1).max(64)).max(10),
});

export const listAdminsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().min(1).max(32).optional(),
  role: z.string().min(1).max(64).optional(),
  search: z.string().min(1).max(255).optional(),
  sort: z.string().min(1).max(64).optional(),
});

export const adminStatusSchema = z.object({
  status: z.string().min(1).max(32),
  reason: z.string().min(1).max(500),
});

export const assignRolesSchema = z.object({
  roleKeys: z.array(z.string().min(1).max(64)).max(10),
});

export const checkEmailQuerySchema = z.object({
  email: z.email().max(255),
});
