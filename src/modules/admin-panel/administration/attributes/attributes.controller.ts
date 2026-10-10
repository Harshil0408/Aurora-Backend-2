import type { Request, Response } from 'express';
import { z } from 'zod';
import { ok, paginated } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import {
  createAttribute,
  deleteAttribute,
  getAttribute,
  listAttributeTypes,
  listAttributes,
  setAttributeStatus,
  updateAttribute,
} from './attributes.service.js';
import {
  createAttributeSchema,
  listAttributesQuerySchema,
  setAttributeStatusSchema,
  updateAttributeSchema,
} from './attributes.schemas.js';

const idParams = z.object({ id: z.string().min(1) });

export const listAttributesHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ATTRIBUTE_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const query = listAttributesQuerySchema.parse(req.query);
    const { data, total } = await listAttributes(query);
    res.status(200).json(paginated(data, query.page, query.limit, total));
  }),
];

export const listAttributeTypesHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ATTRIBUTE_READ),
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(ok(await listAttributeTypes()));
  }),
];

export const getAttributeHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ATTRIBUTE_READ),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = idParams.parse(req.params);
    res.status(200).json(ok(await getAttribute(id)));
  }),
];

export const createAttributeHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ATTRIBUTE_CREATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const input = createAttributeSchema.parse(req.body);
    const created = await createAttribute(input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(201).json(ok(created));
  }),
];

export const updateAttributeHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ATTRIBUTE_UPDATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const input = updateAttributeSchema.parse(req.body);
    const updated = await updateAttribute(
      id,
      input,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const setAttributeStatusHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ATTRIBUTE_UPDATE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    const { status, reason } = setAttributeStatusSchema.parse(req.body);
    const updated = await setAttributeStatus(
      id,
      status,
      reason,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const deleteAttributeHandler = [
  requireAuth,
  requirePerm(PERMISSIONS.ATTRIBUTE_DELETE),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParams.parse(req.params);
    res
      .status(200)
      .json(ok(await deleteAttribute(id, { adminId: auth.adminId }, getRequestMeta(req))));
  }),
];
