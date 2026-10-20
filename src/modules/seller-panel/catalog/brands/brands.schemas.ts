import { z } from 'zod';

const urlSchema = z
  .string()
  .max(512)
  .refine(
    (v) => v === '' || /^https?:\/\//.test(v) || v.startsWith('/uploads/'),
    'Must be an http(s) URL or a /uploads/ path',
  );

export const sellerListBrandsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().min(1).max(255).optional(),
  // Unbranded products need no brand row; sellers sometimes still want
  // only-open brands for quick picking.
  openOnly: z.coerce.boolean().default(false),
});

export const createBrandRequestSchema = z.object({
  name: z.string().min(2).max(128),
  website: z.string().max(512).optional(),
  justification: z.string().min(10).max(1000),
  // Seller media-asset ids (Module 1) proving ownership/authorisation.
  proofAssetIds: z.array(z.string().min(1)).max(10).default([]),
  logoUrl: urlSchema.optional(),
});

export type CreateBrandRequestInput = z.infer<typeof createBrandRequestSchema>;

export const ownQueueQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

export const storeBrandParamsSchema = z.object({
  storeId: z.string().min(1),
  brandId: z.string().min(1),
});

export const applyBrandAccessSchema = z.object({
  // Authorisation letters/licences — PDFs stay private like Module 1 docs.
  documentAssetIds: z.array(z.string().min(1)).min(1).max(10),
  note: z.string().max(1000).optional(),
  // Seller-proposed renewal horizon; the admin confirms it on approval.
  expiresAt: z.string().datetime().optional(),
});

export type ApplyBrandAccessInput = z.infer<typeof applyBrandAccessSchema>;
