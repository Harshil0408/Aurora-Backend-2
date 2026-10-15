import { z } from 'zod';

const urlSchema = z.string().max(1024).refine(
  (v) => v === '' || /^https?:\/\//.test(v) || v.startsWith('/uploads/'),
  'Must be an http(s) URL or a /uploads/ path',
);

export const createCategorySchema = z.object({
  name: z.string().min(2).max(128),
  slug: z
    .string()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase-hyphen')
    .optional(),
  parentId: z.string().min(1).nullable().optional(),
  description: z.string().max(2000).optional(),
  imageUrl: urlSchema.optional(),
  bannerUrl: urlSchema.optional(),
  icon: z.string().max(64).optional(),
  displayOrder: z.number().int().min(0).max(1_000_000).default(0),
  showInNav: z.boolean().default(true),
  showOnHomepage: z.boolean().default(false),
  restricted: z.boolean().default(false),
  metaTitle: z.string().max(160).optional(),
  metaDescription: z.string().max(320).optional(),
  canonicalUrl: urlSchema.optional(),
  ogImageUrl: urlSchema.optional(),
  // Placeholders (Modules 4/5/29) — accepted, stored, not yet enforced.
  attributeSetId: z.string().max(64).nullable().optional(),
  taxClassId: z.string().max(64).nullable().optional(),
  commissionRateBps: z.number().int().min(0).max(10_000).nullable().optional(),
  returnWindowDays: z.number().int().min(0).max(365).nullable().optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema
  .omit({ displayOrder: true })
  .partial()
  .extend({
    displayOrder: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const listCategoriesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().min(1).max(255).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  parentId: z.string().min(1).optional(),
  rootOnly: z.coerce.boolean().default(false),
  includeDeleted: z.coerce.boolean().default(false),
});

export const setCategoryStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
  reason: z.string().min(3).max(500),
});

export const deleteCategorySchema = z.object({
  reason: z.string().min(3).max(500),
  // Move non-deleted children here instead of blocking the delete.
  reassignTo: z.string().min(1).nullable().optional(),
});

// Import rows stay lenient on purpose: malformed rows must surface as
// per-row errors in the preview, not as a whole-request 400.
const importRowSchema = z.object({
  name: z.string().min(1).max(128),
  slug: z.string().max(160).optional(),
  parentId: z.string().min(1).optional(),
  // Parents resolve by slug path ("fashion/men/kurtas") or blank root.
  parentPath: z.string().max(2000).optional(),
  description: z.string().max(5000).optional(),
  displayOrder: z.coerce.number().int().min(0).max(1_000_000).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  showInNav: z.boolean().optional(),
});

export const importCategoriesSchema = z.object({
  mode: z.enum(['validate', 'commit']).default('validate'),
  rows: importRowSchema.array().min(1).max(1000),
});

export const reviewCategoryRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().max(1000).optional(),
  // Link the request to the real node the admin created for it.
  resolvedCategoryId: z.string().min(1).nullable().optional(),
});

export const reviewAccessGrantSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().max(1000).optional(),
});

export const reviewQueueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
});
