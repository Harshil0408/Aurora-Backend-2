import { z } from 'zod';

/**
 * Platform commerce settings (Phase 1 — Module 5) — the singleton row
 * (id 'singleton') carries inclusive-tax pricing, base/display currencies
 * and the money rounding mode. The checkout engine and storefront render
 * read this row; Store may override the inclusive-tax default via its own
 * nullable `priceIncludesTax` column (store settings arrive in Module 6).
 */

const currency = z.string().regex(/^[A-Z]{3}$/, 'Currency must be a 3-letter ISO code (e.g. INR)');

export const updateSettingsSchema = z
  .object({
    priceIncludesTax: z.boolean().optional(),
    baseCurrency: currency.optional(),
    displayCurrency: currency.optional(),
    roundingMode: z.enum(['NONE', 'ROUND_HALF_UP', 'ROUND_UP_TO_RUPEE']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
