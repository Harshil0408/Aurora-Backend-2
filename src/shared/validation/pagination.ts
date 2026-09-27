import { z } from 'zod';

/** Shared ?page=&limit= query shape for all paginated data tables. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
