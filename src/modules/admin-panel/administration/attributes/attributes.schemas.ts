import { z } from 'zod';

export const attributeTypeSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Type must be lowercase alphanumeric with underscores');

export const attributeKeySchema = z
  .string()
  .min(2)
  .max(128)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Key must be a lowercase-hyphen slug');

export const createAttributeSchema = z.object({
  type: attributeTypeSchema,
  key: attributeKeySchema,
  label: z.string().min(1).max(255),
  value: z.string().max(255).optional(),
  description: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).default(0),
});

export type CreateAttributeInput = z.infer<typeof createAttributeSchema>;

export const updateAttributeSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  value: z.string().max(255).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
});

export type UpdateAttributeInput = z.infer<typeof updateAttributeSchema>;

export const listAttributesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.string().min(1).max(64).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  search: z.string().min(1).max(255).optional(),
});

export const setAttributeStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
  reason: z.string().min(3).max(500),
});
