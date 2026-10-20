import { z } from 'zod';

const urlSchema = z
  .string()
  .max(1024)
  .refine(
    (v) => v === '' || /^https?:\/\//.test(v) || v.startsWith('/uploads/'),
    'Must be an http(s) URL or a /uploads/ path',
  );

export const createBrandSchema = z.object({
  name: z.string().min(2).max(128),
  slug: z
    .string()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase-hyphen')
    .optional(),
  logoUrl: urlSchema.optional(),
  bannerUrl: urlSchema.optional(),
  description: z.string().max(2000).optional(),
  website: z.string().max(512).optional(),
  country: z.string().max(64).optional(),
  restricted: z.boolean().default(false),
  featured: z.boolean().default(false),
});

export type CreateBrandInput = z.infer<typeof createBrandSchema>;

export const updateBrandSchema = createBrandSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;

export const listBrandsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().min(1).max(255).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  restricted: z.coerce.boolean().optional(),
  featured: z.coerce.boolean().optional(),
  includeDeleted: z.coerce.boolean().default(false),
});

export const setBrandStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
  reason: z.string().min(3).max(500),
});

export const mergeBrandSchema = z.object({
  // Re-point this brand's authorisations + resolve history to the target.
  targetId: z.string().min(1),
  reason: z.string().min(3).max(500),
});

const importRowSchema = z.object({
  name: z.string().min(1).max(128),
  slug: z.string().max(160).optional(),
  description: z.string().max(5000).optional(),
  website: z.string().max(512).optional(),
  country: z.string().max(64).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  restricted: z.boolean().optional(),
  featured: z.boolean().optional(),
});

// Lenient on purpose: malformed rows surface as per-row preview errors,
// never a whole-request 400 (same contract as the category import).
export const importBrandsSchema = z.object({
  mode: z.enum(['validate', 'commit']).default('validate'),
  rows: importRowSchema.array().min(1).max(1000),
});

export const reviewBrandRequestSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().max(1000).optional(),
  resolvedBrandId: z.string().min(1).nullable().optional(),
});

export const reviewBrandAuthorisationSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().max(1000).optional(),
  // Renewal horizon for approvals (seller-proposed one is on the row).
  expiresAt: z.string().datetime().nullable().optional(),
});

export const reviewQueueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING'),
});
