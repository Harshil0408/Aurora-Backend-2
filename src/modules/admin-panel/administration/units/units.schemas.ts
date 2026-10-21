import { z } from 'zod';

/**
 * Units of measure (Phase 1 — Module 5). Conversion is factor-based: each
 * unit belongs to a dimension and carries factor = how many BASE units one
 * of itself is (kg/m/l/piece ⇒ 1; g = 0.001 kg, mm = 0.001 m, ml = 0.001 l).
 * Valid conversions exist only WITHIN a dimension.
 */

const unitCode = z
  .string()
  .min(1)
  .max(16)
  .regex(/^[a-z][a-z0-9_]*$/, 'Unit code must be lowercase snake_case, e.g. kg or sq_m');

export const createUnitSchema = z.object({
  code: unitCode,
  name: z.string().min(1).max(64),
  dimension: z.enum(['MASS', 'LENGTH', 'VOLUME', 'QUANTITY']),
  /** Base unit of the dimension (must exist with factor 1). */
  baseCode: unitCode,
  /** How many base units one of this unit is. */
  factor: z.number().min(0.000000001).max(1_000_000_000),
});

export const updateUnitSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  dimension: z.enum(['MASS', 'LENGTH', 'VOLUME', 'QUANTITY']).optional(),
  baseCode: unitCode.optional(),
  factor: z.number().min(0.000000001).max(1_000_000_000).optional(),
});

export const listUnitsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  dimension: z.enum(['MASS', 'LENGTH', 'VOLUME', 'QUANTITY']).optional(),
  search: z.string().min(1).max(255).optional(),
});

export const unitIdParamSchema = z.object({ id: z.string().min(1) });

export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
