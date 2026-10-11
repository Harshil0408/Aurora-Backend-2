import { z } from 'zod';

/**
 * Public catalog query — same shape as the admin list minus `status`.
 * Status is always forced to ACTIVE server-side so INACTIVE rows never leak.
 */
export const listPublicAttributesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.string().min(1).max(64).optional(),
  search: z.string().min(1).max(255).optional(),
});

export type ListPublicAttributesQuery = z.infer<typeof listPublicAttributesQuerySchema>;
