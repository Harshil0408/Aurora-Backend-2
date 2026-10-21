import type { Request, Response } from 'express';
import { z } from 'zod';
import { ok } from '../../../../shared/utils/ApiResponse.js';
import { asyncHandler } from '../../../../shared/utils/asyncHandler.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { PERMISSIONS } from '../../../rbac/permissions.js';
import { getAuth, requireAuth } from '../../auth/middleware/requireAuth.js';
import { requirePerm } from '../../auth/middleware/requirePerm.js';
import {
  addOption,
  createProductAttribute,
  deleteOption,
  deleteProductAttribute,
  getProductAttribute,
  listOptionSuggestions,
  listProductAttributes,
  reorderOptions,
  reviewSuggestion,
  setProductAttributeStatus,
  updateOption,
  updateProductAttribute,
} from './catalog-attributes.service.js';
import {
  createOptionSchema,
  createProductAttributeSchema,
  idParamSchema,
  listOptionSuggestionsQuerySchema,
  listProductAttributesQuerySchema,
  optionParamsSchema,
  reorderOptionsSchema,
  setAttributeStatusSchema,
  suggestReviewSchema,
  updateOptionSchema,
  updateProductAttributeSchema,
} from './catalog-attributes.schemas.js';

/**
 * Handlers for the product-attribute catalog screen (Module 4).
 * Static queue routes register BEFORE /:id in the router so the param
 * route never swallows them.
 */
const perm = () => PERMISSIONS.ATTRIBUTE_MANAGE;

export const listProductAttributesHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit, ...filters } = listProductAttributesQuerySchema.parse(req.query);
    const { data, pagination } = await listProductAttributes({ page, limit, ...filters });
    res.status(200).json({ success: true, data, pagination });
  }),
];

export const getProductAttributeHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = idParamSchema.parse(req.params);
    res.status(200).json(ok(await getProductAttribute(id)));
  }),
];

export const createProductAttributeHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const input = createProductAttributeSchema.parse(req.body);
    const created = await createProductAttribute(
      input,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(201).json(ok(created));
  }),
];

export const updateProductAttributeHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const input = updateProductAttributeSchema.parse(req.body);
    const updated = await updateProductAttribute(
      id,
      input,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const setProductAttributeStatusHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const { status, reason } = setAttributeStatusSchema.parse(req.body);
    const updated = await setProductAttributeStatus(
      id,
      status,
      reason,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const deleteProductAttributeHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const deleted = await deleteProductAttribute(
      id,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(deleted));
  }),
];

export const addOptionHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const input = createOptionSchema.parse(req.body);
    const created = await addOption(id, input, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(201).json(ok(created));
  }),
];

export const updateOptionHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id, optionId } = optionParamsSchema.parse(req.params);
    const input = updateOptionSchema.parse(req.body);
    const updated = await updateOption(
      id,
      optionId,
      input,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(updated));
  }),
];

export const reorderOptionsHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id } = idParamSchema.parse(req.params);
    const { orders } = reorderOptionsSchema.parse(req.body);
    const result = await reorderOptions(id, orders, { adminId: auth.adminId }, getRequestMeta(req));
    res.status(200).json(ok(result));
  }),
];

export const deleteOptionHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { id, optionId } = optionParamsSchema.parse(req.params);
    const deleted = await deleteOption(
      id,
      optionId,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(deleted));
  }),
];

export const listOptionSuggestionsHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { page, limit, attributeId } = listOptionSuggestionsQuerySchema.parse(req.query);
    const { data, total } = await listOptionSuggestions({ page, limit, attributeId });
    res.status(200).json({
      success: true,
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
];

export const reviewSuggestionHandler = [
  requireAuth,
  requirePerm(perm()),
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { optionId } = z.object({ optionId: z.string().min(1) }).parse(req.params);
    const input = suggestReviewSchema.parse(req.body);
    const reviewed = await reviewSuggestion(
      optionId,
      input,
      { adminId: auth.adminId },
      getRequestMeta(req),
    );
    res.status(200).json(ok(reviewed));
  }),
];
