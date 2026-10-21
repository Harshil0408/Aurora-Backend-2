import { z } from 'zod';

/**
 * Product attribute definitions (Module 4). Distinct from the generic
 * key-value lookup `attributes` screen — this catalog drives the product
 * form, storefront filters and variant generation.
 */

export const PRODUCT_ATTRIBUTE_TYPES = [
  'TEXT',
  'TEXTAREA',
  'NUMBER',
  'DECIMAL',
  'BOOLEAN',
  'DROPDOWN',
  'MULTI_SELECT',
  'COLOR_SWATCH',
  'IMAGE_SWATCH',
  'DATE',
] as const;

export type ProductAttributeType = (typeof PRODUCT_ATTRIBUTE_TYPES)[number];

export const attributeCodeSchema = z
  .string()
  .max(160)
  .regex(/^[a-z][a-z0-9_]*$/, 'Code must be lowercase alphanumeric with underscores');

export const swatchHexSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Swatch must be a 3 or 6 digit hex colour');

export const createOptionSchema = z.object({
  label: z.string().min(1).max(128),
  value: z.string().min(1).max(160),
  swatchHex: swatchHexSchema.optional(),
  imageUrl: z
    .string()
    .max(1024)
    .refine((v) => /^https?:\/\//.test(v) || v.startsWith('/uploads/'), {
      message: 'Must be an http(s) URL or a /uploads/ path',
    })
    .optional(),
  displayOrder: z.number().int().min(0).max(100_000).default(0),
});

export const updateOptionSchema = z.object({
  label: z.string().min(1).max(128).optional(),
  value: z.string().min(1).max(160).optional(),
  swatchHex: swatchHexSchema.nullable().optional(),
  imageUrl: z
    .string()
    .max(1024)
    .refine((v) => /^https?:\/\//.test(v) || v.startsWith('/uploads/'), {
      message: 'Must be an http(s) URL or a /uploads/ path',
    })
    .nullable()
    .optional(),
  displayOrder: z.number().int().min(0).max(100_000).optional(),
  status: z.enum(['SUGGESTED', 'ACTIVE', 'DISABLED']).optional(),
});

export const reorderOptionsSchema = z.object({
  orders: z
    .array(z.object({ id: z.string().min(1), displayOrder: z.number().int().min(0).max(100_000) }))
    .min(1)
    .max(500),
});

export const suggestReviewSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewNote: z.string().min(3).max(500).optional(),
});

export const createProductAttributeSchema = z
  .object({
    name: z.string().min(2).max(128),
    code: attributeCodeSchema.optional(),
    type: z.enum(PRODUCT_ATTRIBUTE_TYPES).default('TEXT'),
    unit: z.string().max(32).optional(),
    helpText: z.string().max(500).optional(),
    required: z.boolean().default(false),
    filterable: z.boolean().default(false),
    searchable: z.boolean().default(false),
    comparable: z.boolean().default(false),
    variantDefining: z.boolean().default(false),
    visibleOnPage: z.boolean().default(true),
    validationMin: z.number().nullable().optional(),
    validationMax: z.number().nullable().optional(),
    validationRegex: z.string().max(500).nullable().optional(),
    allowedUnits: z.array(z.string().max(32)).max(50).default([]),
    // Seed options inline at creation time (dropdown/select attributes).
    options: z.array(createOptionSchema).max(200).default([]),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'NUMBER' || val.type === 'DECIMAL' || val.type === 'DATE') {
      if (
        val.validationMin !== null &&
        val.validationMax !== null &&
        val.validationMin !== undefined &&
        val.validationMax !== undefined &&
        val.validationMin > val.validationMax
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['validationMax'],
          message: 'validationMax must be greater than or equal to validationMin',
        });
      }
    }
  });

export const updateProductAttributeSchema = z
  .object({
    name: z.string().min(2).max(128).optional(),
    // Code is a machine key (matches stored product values) — immutable.
    type: z.enum(PRODUCT_ATTRIBUTE_TYPES).optional(),
    unit: z.string().max(32).nullable().optional(),
    helpText: z.string().max(500).nullable().optional(),
    required: z.boolean().optional(),
    filterable: z.boolean().optional(),
    searchable: z.boolean().optional(),
    comparable: z.boolean().optional(),
    variantDefining: z.boolean().optional(),
    visibleOnPage: z.boolean().optional(),
    validationMin: z.number().nullable().optional(),
    validationMax: z.number().nullable().optional(),
    validationRegex: z.string().max(500).nullable().optional(),
    allowedUnits: z.array(z.string().max(32)).max(50).optional(),
  })
  .superRefine((val, ctx) => {
    if (
      val.validationMin !== undefined &&
      val.validationMin !== null &&
      val.validationMax !== undefined &&
      val.validationMax !== null &&
      val.validationMin > val.validationMax
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['validationMax'],
        message: 'validationMax must be greater than or equal to validationMin',
      });
    }
  });

export const setAttributeStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']),
  reason: z.string().min(3).max(500),
});

export const listProductAttributesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(PRODUCT_ATTRIBUTE_TYPES).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  search: z.string().min(1).max(255).optional(),
  includeDeleted: z.coerce.boolean().default(false),
});

export const listOptionSuggestionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  attributeId: z.string().min(1).optional(),
});

const idParams = z.object({ id: z.string().min(1) });

export const idParamSchema = idParams;

export const optionParamsSchema = z.object({ id: z.string().min(1), optionId: z.string().min(1) });

export type CreateProductAttributeInput = z.infer<typeof createProductAttributeSchema>;
export type UpdateProductAttributeInput = z.infer<typeof updateProductAttributeSchema>;
export type CreateProductAttributeOptionInput = z.infer<typeof createOptionSchema>;
export type UpdateProductAttributeOptionInput = z.infer<typeof updateOptionSchema>;
export type SuggestReviewInput = z.infer<typeof suggestReviewSchema>;
