import { z } from 'zod';

const actionValue = z.string().min(1).max(128);

/** Strict YYYY-MM-DD with real calendar validation (bounds built in service). */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date as YYYY-MM-DD')
  .refine(
    (s) => {
      const [y, m, d] = s.split('-').map(Number);
      if (!y || !m || !d) return false;
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    },
    { message: 'Invalid calendar date' },
  );

/**
 * GET /activity — repeatable ?action= is OR-combined; unknown values match
 * nothing (never an error). `limit` clamps to 100 (feed convention: never
 * error on oversized pages, unlike the shared pagination schema).
 */
export const activityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(20)
    .transform((v) => Math.min(v, 100)),
  action: z
    .union([actionValue, z.array(actionValue).max(20)])
    .optional()
    .transform((v) => (v === undefined ? [] : [...new Set(Array.isArray(v) ? v : [v])])),
  q: z.string().min(1).max(200).optional(),
  actor: z.string().min(1).max(320).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
});

/** GET /activity/actions — same filters minus action/sort/page/limit (counts describe the other filters). */
export const activityFilterSchema = z.object({
  q: z.string().min(1).max(200).optional(),
  actor: z.string().min(1).max(320).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
});

export const activityIdParams = z.object({ id: z.string().min(1).max(64) });
