import { z } from 'zod';

/**
 * Tax-class schemas (Phase 1 — Module 5).
 *
 * A class owns the GST headline + cess via `TaxRate` rows: 'ALL' is the
 * nationwide base, any other region is a state/UT code override (e.g. KA,
 * MH, DL). The CGST/SGST vs IGST split is DERIVED at quote time — it is
 * never stored. Deletion is blocked while categories still reference the
 * class; the checkout engine (orders module) snapshots rates per line so
 * historic invoices never depend on this master staying stable.
 */

/** 'ALL' or a 2-letter state/UT code. */
export const regionCodeSchema = z
  .string()
  .max(8)
  .regex(/^(ALL|[A-Z]{2})$/, "Region must be 'ALL' or a 2-letter uppercase state/UT code");

export const percentSchema = z.number().min(0).max(99.99);

const stateCode = z
  .string()
  .max(8)
  .regex(/^[A-Z]{2}$/, 'State must be a 2-letter uppercase code');

export const createTaxClassSchema = z.object({
  name: z.string().min(2).max(128),
  description: z.string().max(500).optional(),
});

export const updateTaxClassSchema = z.object({
  name: z.string().min(2).max(128).optional(),
  description: z.string().max(500).nullable().optional(),
});

export const setTaxClassStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
  reason: z.string().min(3).max(500),
});

export const createTaxRateSchema = z.object({
  region: regionCodeSchema.default('ALL'),
  ratePercent: percentSchema,
  cessPercent: percentSchema.default(0),
});

export const updateTaxRateSchema = z.object({
  ratePercent: percentSchema.optional(),
  cessPercent: percentSchema.optional(),
});

export const quoteInputSchema = z.object({
  amount: z.number().min(0).max(10_000_000_000),
  taxClassId: z.string().min(1),
  sellerState: stateCode,
  buyerState: stateCode.optional(),
  // Default: fall back to the platform/store inclusive-tax setting.
  inclusive: z.boolean().optional(),
  rounding: z.enum(['none', 'half-up', 'rup']).optional(),
});

export const listTaxClassesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  search: z.string().min(1).max(255).optional(),
});

const idParams = z.object({ id: z.string().min(1) });
const rateParams = z.object({ id: z.string().min(1), rateId: z.string().min(1) });

export const taxClassIdParamSchema = idParams;
export const taxRateParamsSchema = rateParams;

export type CreateTaxClassInput = z.infer<typeof createTaxClassSchema>;
export type UpdateTaxClassInput = z.infer<typeof updateTaxClassSchema>;
export type CreateTaxRateInput = z.infer<typeof createTaxRateSchema>;
export type UpdateTaxRateInput = z.infer<typeof updateTaxRateSchema>;
export type QuoteInput = z.infer<typeof quoteInputSchema>;
