import type { Request, Response } from 'express';
import { z } from 'zod';
import { notFound } from '../../../shared/errors/AppError.js';
import { ok, paginated } from '../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../shared/utils/asyncHandler.js';
import {
  getAttribute,
  listAttributeTypes,
  listAttributes,
} from '../../admin-panel/administration/attributes/attributes.service.js';
import { listPublicAttributesQuerySchema } from './public-attributes.schemas.js';

const idParams = z.object({ id: z.string().min(1) });

/**
 * Public read-only catalog — no auth. Every read is scoped to ACTIVE rows
 * so draft/deactivated lookups stay hidden. Usable from the storefront,
 * seller panel, or anywhere else without an admin session.
 */
export const listPublicAttributesHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = listPublicAttributesQuerySchema.parse(req.query);
    const { data, total } = await listAttributes({ ...query, status: 'ACTIVE' });
    res.status(200).json(paginated(data, query.page, query.limit, total));
  },
);

export const listPublicAttributeTypesHandler = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(ok(await listAttributeTypes('ACTIVE')));
  },
);

export const getPublicAttributeHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { id } = idParams.parse(req.params);
    const row = await getAttribute(id);
    if (row.status !== 'ACTIVE') throw notFound('Attribute not found');
    res.status(200).json(ok(row));
  },
);
