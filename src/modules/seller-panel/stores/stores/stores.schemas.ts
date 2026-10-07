import { z } from 'zod';

export const createStoreSchema = z.object({
  name: z.string().min(2).max(128),
  slug: z
    .string()
    .min(2)
    .max(128)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens')
    .optional(),
  description: z.string().max(1000).optional(),
  category: z.string().max(128).optional(),
  country: z.string().max(64).optional(),
  currency: z.string().min(3).max(8).default('INR'),
  timezone: z.string().max(64).default('Asia/Kolkata'),
  contactEmail: z.email().max(255).optional(),
  contactPhone: z.string().max(32).optional(),
  logo: z.string().max(512).optional(),
});

export type CreateStoreInput = z.infer<typeof createStoreSchema>;

export const updateStoreSchema = z.object({
  name: z.string().min(2).max(128).optional(),
  description: z.string().max(1000).nullable().optional(),
  category: z.string().max(128).nullable().optional(),
  country: z.string().max(64).nullable().optional(),
  currency: z.string().min(3).max(8).optional(),
  timezone: z.string().max(64).optional(),
  contactEmail: z.email().max(255).nullable().optional(),
  contactPhone: z.string().max(32).nullable().optional(),
  logo: z.string().max(512).nullable().optional(),
});

export type UpdateStoreInput = z.infer<typeof updateStoreSchema>;

export const switchStoreSchema = z.object({
  storeId: z.string().min(1),
});
