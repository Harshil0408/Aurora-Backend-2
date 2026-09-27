import { z } from 'zod';

/** POST /roles — Roles screen: Create Role modal (key is a permanent slug). */
export const createRoleSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Key must be a slug: lowercase letters/numbers with single hyphens (e.g. billing-analyst). Keys are permanent and cannot be renamed.',
    ),
  name: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
});

/** PATCH /roles/:key — edit display name / description only (key never renamable). */
export const updateRoleSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(500).nullable().optional(),
});

/** PUT /roles/:key/permissions — Roles screen: Edit Permissions matrix. */
export const updateRolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string().min(1).max(64)).max(50),
});
