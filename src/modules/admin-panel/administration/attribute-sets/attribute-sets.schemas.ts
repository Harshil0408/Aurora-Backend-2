import { z } from 'zod';

/**
 * Attribute-set schemas (Module 4): named bundles of product attributes
 * that drive the product form, grouped for form layout and PDP spec tabs,
 * and assigned to categories (spec: one set per category, inherited down
 * the tree, overridable at any level).
 */

export const attributeSetSlugSchema = z
  .string()
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be a lowercase-hyphen slug');

export const createAttributeSetSchema = z.object({
  name: z.string().min(2).max(128),
  slug: attributeSetSlugSchema.optional(),
  description: z.string().max(500).optional(),
});

export const updateAttributeSetSchema = z.object({
  name: z.string().min(2).max(128).optional(),
  slug: attributeSetSlugSchema.optional(),
  description: z.string().max(500).nullable().optional(),
});

export const setAttributeSetStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
  reason: z.string().min(3).max(500),
});

export const cloneAttributeSetSchema = z.object({
  name: z.string().min(2).max(128).optional(),
  slug: attributeSetSlugSchema.optional(),
});

export const createGroupSchema = z.object({
  name: z.string().min(1).max(64),
  displayOrder: z.number().int().min(0).max(100_000).default(0),
});

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  displayOrder: z.number().int().min(0).max(100_000).optional(),
});

export const attachItemSchema = z.object({
  attributeId: z.string().min(1),
  groupId: z.string().min(1).nullable().optional(),
  // Null = inherit the attribute-level `required` flag.
  required: z.boolean().nullable().optional(),
  displayOrder: z.number().int().min(0).max(100_000).default(0),
});

export const updateItemSchema = z.object({
  groupId: z.string().min(1).nullable().optional(),
  required: z.boolean().nullable().optional(),
  displayOrder: z.number().int().min(0).max(100_000).optional(),
});

export const reorderItemsSchema = z.object({
  orders: z
    .array(z.object({ id: z.string().min(1), displayOrder: z.number().int().min(0).max(100_000) }))
    .min(1)
    .max(500),
});

export const listAttributeSetsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  search: z.string().min(1).max(255).optional(),
});

const setIdParams = z.object({ id: z.string().min(1) });
const itemParams = z.object({ id: z.string().min(1), itemId: z.string().min(1) });
const groupParams = z.object({ id: z.string().min(1), groupId: z.string().min(1) });

export const setIdParamSchema = setIdParams;
export const itemParamsSchema = itemParams;
export const groupParamsSchema = groupParams;

export type CreateAttributeSetInput = z.infer<typeof createAttributeSetSchema>;
export type UpdateAttributeSetInput = z.infer<typeof updateAttributeSetSchema>;
export type CloneAttributeSetInput = z.infer<typeof cloneAttributeSetSchema>;
export type AttachItemInput = z.infer<typeof attachItemSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
