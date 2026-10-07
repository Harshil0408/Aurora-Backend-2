import { z } from 'zod';

export const createRoleSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Key must be a lowercase-hyphen slug'),
  name: z.string().min(2).max(128),
  description: z.string().max(500).optional(),
  permissionKeys: z.array(z.string().min(1)).max(100).optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().min(2).max(128).optional(),
  description: z.string().max(500).nullable().optional(),
});

export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const setPermissionsSchema = z.object({
  permissionKeys: z.array(z.string().min(1)).max(100),
});

export const updateMemberRoleSchema = z.object({
  roleKey: z.string().min(1).max(64),
});

export const inviteMemberSchema = z.object({
  email: z.email().max(255),
  roleKey: z.string().min(1).max(64),
});
