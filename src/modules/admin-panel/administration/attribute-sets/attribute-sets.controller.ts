import type { Request, Response } from 'express';
import { ok } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import {
  attachItem,
  cloneAttributeSet,
  createAttributeSet,
  createGroup,
  deleteAttributeSet,
  deleteGroup,
  detachItem,
  getAttributeSet,
  listAttributeSets,
  reorderItems,
  setAttributeSetStatus,
  updateAttributeSet,
  updateGroup,
  updateItem,
} from './attribute-sets.service.js';
import {
  attachItemSchema,
  cloneAttributeSetSchema,
  createAttributeSetSchema,
  createGroupSchema,
  groupParamsSchema,
  setIdParamSchema,
  itemParamsSchema,
  listAttributeSetsQuerySchema,
  reorderItemsSchema,
  setAttributeSetStatusSchema,
  updateAttributeSetSchema,
  updateGroupSchema,
  updateItemSchema,
} from './attribute-sets.schemas.js';

/**
 * Handlers for the attribute-set screen (Module 4).
 */
const perm = () => PERMISSIONS.ATTRIBUTE_MANAGE;

export const listAttributeSetsHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit, ...filters } = listAttributeSetsQuerySchema.parse(req.query);
    const { data, pagination } = await listAttributeSets({ page, limit, ...filters });
    res.status(200).json({ success: true, data, pagination });
  }),
];

export const getAttributeSetHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = setIdParamSchema.parse(req.params);
    res.status(200).json(ok(await getAttributeSet(id)));
  }),
];

export const createAttributeSetHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const input = createAttributeSetSchema.parse(req.body);
    const created = await createAttributeSet(input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(201).json(ok(created));
  }),
];

export const updateAttributeSetHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = setIdParamSchema.parse(req.params);
    const input = updateAttributeSetSchema.parse(req.body);
    const updated = await updateAttributeSet(
      id,
      input,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const setAttributeSetStatusHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = setIdParamSchema.parse(req.params);
    const { status, reason } = setAttributeSetStatusSchema.parse(req.body);
    const updated = await setAttributeSetStatus(
      id,
      status,
      reason,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const deleteAttributeSetHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = setIdParamSchema.parse(req.params);
    const deleted = await deleteAttributeSet(id, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(deleted));
  }),
];

export const cloneAttributeSetHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = setIdParamSchema.parse(req.params);
    const input = cloneAttributeSetSchema.parse(req.body ?? {});
    const clone = await cloneAttributeSet(
      id,
      input,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(201).json(ok(clone));
  }),
];

export const createGroupHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = setIdParamSchema.parse(req.params);
    const input = createGroupSchema.parse(req.body);
    const created = await createGroup(id, input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(201).json(ok(created));
  }),
];

export const updateGroupHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id, groupId } = groupParamsSchema.parse(req.params);
    const input = updateGroupSchema.parse(req.body);
    const updated = await updateGroup(
      id,
      groupId,
      input,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const deleteGroupHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id, groupId } = groupParamsSchema.parse(req.params);
    const deleted = await deleteGroup(id, groupId, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(deleted));
  }),
];

export const attachItemHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = setIdParamSchema.parse(req.params);
    const input = attachItemSchema.parse(req.body);
    const created = await attachItem(id, input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(201).json(ok(created));
  }),
];

export const updateItemHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id, itemId } = itemParamsSchema.parse(req.params);
    const input = updateItemSchema.parse(req.body);
    const updated = await updateItem(
      id,
      itemId,
      input,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const reorderItemsHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = setIdParamSchema.parse(req.params);
    const { orders } = reorderItemsSchema.parse(req.body);
    const result = await reorderItems(id, orders, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(result));
  }),
];

export const detachItemHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id, itemId } = itemParamsSchema.parse(req.params);
    const detached = await detachItem(id, itemId, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(detached));
  }),
];
