import { z } from 'zod';

/**
 * HSN/SAC code master (Phase 1 — Module 5). Codes are 4, 6 or 8 digits
 * (digit-length validation only — full chapter validation lands with the
 * products module, which snapshots the code string onto order lines).
 */

const hsnCode = z
  .string()
  .regex(/^[0-9]{4}$|^[0-9]{6}$|^[0-9]{8}$/, 'Code must be 4, 6 or 8 digits');

export const createHsnCodeSchema = z.object({
  kind: z.enum(['HSN', 'SAC']).default('HSN'),
  code: hsnCode,
  description: z.string().max(1000).optional(),
  gstRatePercent: z.number().min(0).max(99.99).optional(),
});

export const updateHsnCodeSchema = z.object({
  code: hsnCode.optional(),
  description: z.string().max(1000).nullable().optional(),
  gstRatePercent: z.number().min(0).max(99.99).nullable().optional(),
});

export const listHsnQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  kind: z.enum(['HSN', 'SAC']).optional(),
  search: z.string().min(1).max(255).optional(),
});

export const hsnIdParamSchema = z.object({ id: z.string().min(1) });

export type CreateHsnCodeInput = z.infer<typeof createHsnCodeSchema>;
export type UpdateHsnCodeInput = z.infer<typeof updateHsnCodeSchema>;
