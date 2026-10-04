import { z } from 'zod';

const roleKey = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Key must be a slug: lowercase letters/numbers with single hyphens (e.g. billing-analyst). Keys are permanent and cannot be renamed.',
  );

const permissionKey = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/,
    'Key must be module.action (lowercase, e.g. session.revoke). Keys are permanent.',
  );

/**
 * POST /roles — omit permissionKeys to grant every ACTIVE catalog permission
 * by default (trim afterwards); pass an explicit array for least-privilege.
 */
export const createRoleSchema = z.object({
  key: roleKey,
  name: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
  permissionKeys: z.array(permissionKey).max(100).optional(),
});

/** PATCH /roles/:key — edit display name / description only (key never renamable). */
export const updateRoleSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(500).nullable().optional(),
});

/** PUT /roles/:key/permissions — Roles screen: Edit Permissions matrix. */
export const updateRolePermissionsSchema = z.object({
  permissionKeys: z.array(permissionKey).max(100),
});

/** POST /roles/:key/permissions — add grants only (idempotent, existing kept). */
export const addRolePermissionsSchema = z.object({
  permissionKeys: z.array(permissionKey).min(1).max(100),
});

/** DELETE /roles/:key/permissions — remove grants only (idempotent, others kept). */
export const removeRolePermissionsSchema = z.object({
  permissionKeys: z.array(permissionKey).min(1).max(100),
});

/** POST /roles/:key/clone — duplicate a role (grants copied, status reset ACTIVE). */
export const cloneRoleSchema = z.object({
  key: roleKey,
  name: z.string().min(1).max(128),
  description: z.string().max(500).optional(),
});

/** PATCH /roles/:key/status — activate / deactivate (INACTIVE grants nothing). */
export const setRoleStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
  reason: z.string().trim().min(3).max(500),
});

/** POST /permissions — Permission catalog: define a new module.action (no code change). */
export const createPermissionSchema = z.object({
  key: permissionKey,
  label: z.string().trim().min(1).max(128).optional(),
  description: z.string().max(500).optional(),
});

/** PATCH /permissions/:key — edit label / description (key never renamable). */
export const updatePermissionSchema = z.object({
  label: z.string().trim().min(1).max(128).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
});

/** PATCH /permissions/:key/status — disable (never authorizes) / re-enable. */
export const setPermissionStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
  reason: z.string().trim().min(3).max(500),
});
