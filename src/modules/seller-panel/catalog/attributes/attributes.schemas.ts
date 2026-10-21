import { z } from 'zod';

export const sellerStoreAttributeParamsSchema = z.object({
  storeId: z.string().min(1),
  attributeId: z.string().min(1),
});

export const sellerCategoryParamsSchema = z.object({
  storeId: z.string().min(1),
  categoryId: z.string().min(1),
});

export const suggestOptionSchema = z.object({
  value: z.string().min(1).max(160),
  label: z.string().min(1).max(128).optional(),
  swatchHex: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Swatch must be a 3 or 6 digit hex colour')
    .optional(),
  imageUrl: z
    .string()
    .max(1024)
    .refine((v) => /^https?:\/\//.test(v) || v.startsWith('/uploads/'), {
      message: 'Must be an http(s) URL or a /uploads/ path',
    })
    .optional(),
});

export type SuggestOptionInput = z.infer<typeof suggestOptionSchema>;
