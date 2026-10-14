import { z } from 'zod';
import { paginationSchema } from '../../../../shared/validation/pagination.js';

export const mediaKindSchema = z.enum(['IMAGE', 'VIDEO', 'DOCUMENT', 'OTHER']);
export const mediaVisibilitySchema = z.enum(['PUBLIC', 'PRIVATE']);

export const listMediaSchema = paginationSchema.extend({
  search: z.string().max(255).optional(),
  kind: mediaKindSchema.optional(),
  folder: z.string().max(128).optional(),
  visibility: mediaVisibilitySchema.optional(),
  tag: z.string().max(64).optional(),
  orphanOnly: z.coerce.boolean().default(false),
});

export type ListMediaInput = z.infer<typeof listMediaSchema>;

export const updateMediaSchema = z
  .object({
    fileName: z.string().min(1).max(255).optional(),
    altText: z.string().max(255).nullable().optional(),
    caption: z.string().max(500).nullable().optional(),
    folder: z.string().min(1).max(128).optional(),
    tags: z.array(z.string().min(1).max(64)).max(20).optional(),
    visibility: mediaVisibilitySchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

export type UpdateMediaInput = z.infer<typeof updateMediaSchema>;

export const mediaIdParamSchema = z.object({
  storeId: z.string().min(1),
  id: z.string().min(1),
});

export const uploadMetaSchema = z.object({
  altText: z.string().max(255).optional(),
  caption: z.string().max(500).optional(),
  folder: z.string().min(1).max(128).default('general'),
  tags: z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v),
    z.array(z.string().min(1).max(64)).max(20).default([]),
  ),
  visibility: mediaVisibilitySchema.default('PUBLIC'),
});

export type UploadMetaInput = z.infer<typeof uploadMetaSchema>;
