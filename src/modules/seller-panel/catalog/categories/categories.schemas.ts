import { z } from 'zod';

export const createCategoryRequestSchema = z.object({
  name: z.string().min(2).max(128),
  justification: z.string().min(10).max(1000),
  proposedParentId: z.string().min(1).nullable().optional(),
});

export type CreateCategoryRequestInput = z.infer<typeof createCategoryRequestSchema>;

export const ownQueueQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
});

export const applyAccessSchema = z.object({
  // Seller media-asset ids (Module 1) proving authorisation — PDFs stay
  // private and the access log records exactly which documents were filed.
  documentAssetIds: z.array(z.string().min(1)).min(1).max(10),
  note: z.string().max(1000).optional(),
});

export type ApplyAccessInput = z.infer<typeof applyAccessSchema>;

export const storeCategoryParamsSchema = z.object({
  storeId: z.string().min(1),
  categoryId: z.string().min(1),
});
