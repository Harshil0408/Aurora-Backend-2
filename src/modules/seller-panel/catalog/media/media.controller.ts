import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { getPrisma } from '../../../../config/db.js';
import { notFound } from '../../../../shared/errors/AppError.js';
import { getRequestMeta } from '../../../../shared/utils/requestMeta.js';
import { getSellerAuth, requireSellerAuth } from '../../auth/middleware/requireSellerAuth.js';
import { getStoreAuth, requireStoreAccess } from '../../stores/middleware/requireStoreAccess.js';
import { STORE_PERMISSIONS } from '../../team/store-permissions.js';
import {
  cleanupOrphans,
  deleteMedia,
  getQuotaStatus,
  listMedia,
  storageRoot,
  updateMedia,
  uploadMedia,
} from './media.service.js';
import {
  listMediaSchema,
  mediaIdParamSchema,
  updateMediaSchema,
  uploadMetaSchema,
} from './media.schemas.js';
import { z } from 'zod';

const upload = multer({
  storage: multer.memoryStorage(),
  // Hard ceiling is the largest single file (video 100 MB); per-type limits
  // are enforced in the service so error messages stay specific.
  limits: { fileSize: 100 * 1024 * 1024, files: 5 },
});

async function actorEmail(sellerId: string): Promise<string | null> {
  const seller = await getPrisma().sellerUser.findUnique({ where: { id: sellerId } });
  return seller?.email ?? null;
}

export const listMediaHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.MEDIA_VIEW),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = listMediaSchema.parse(req.query);
      res.json({ success: true, ...(await listMedia(getStoreAuth(req).storeId, query)) });
    } catch (err) {
      next(err);
    }
  },
];

export const quotaHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.MEDIA_VIEW),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ success: true, data: await getQuotaStatus(getStoreAuth(req).storeId) });
    } catch (err) {
      next(err);
    }
  },
];

export const uploadMediaHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.MEDIA_UPLOAD),
  upload.array('files', 5),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const files = (req.files ?? []) as Express.Multer.File[];
      if (files.length === 0) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'No files received (field: files)' },
        });
        return;
      }
      const meta = uploadMetaSchema.parse(req.body);
      const email = await actorEmail(auth.sellerId);
      const results = [];
      for (const file of files) {
        results.push(
          await uploadMedia(
            storeAuth.storeId,
            auth.sellerId,
            email,
            {
              originalname: file.originalname,
              mimetype: file.mimetype,
              size: file.size,
              buffer: file.buffer,
            },
            meta,
            getRequestMeta(req),
          ),
        );
      }
      res.status(201).json({
        success: true,
        data: results.map((r) => ({ ...(r.asset as object), deduped: r.deduped })),
      });
    } catch (err) {
      next(err);
    }
  },
];

export const updateMediaHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.MEDIA_UPLOAD),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { storeId, id } = mediaIdParamSchema.parse(req.params);
      const auth = getSellerAuth(req);
      const input = updateMediaSchema.parse(req.body);
      res.json({
        success: true,
        data: await updateMedia(
          storeId,
          id,
          auth.sellerId,
          await actorEmail(auth.sellerId),
          input,
          getRequestMeta(req),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
];

export const deleteMediaHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.MEDIA_DELETE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { storeId, id } = mediaIdParamSchema.parse(req.params);
      const auth = getSellerAuth(req);
      await deleteMedia(
        storeId,
        id,
        auth.sellerId,
        await actorEmail(auth.sellerId),
        getRequestMeta(req),
      );
      res.json({ success: true, data: { id } });
    } catch (err) {
      next(err);
    }
  },
];

/** Private-asset download + public fallback stream (both require store access). */
export const downloadMediaHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.MEDIA_VIEW),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { storeId, id } = mediaIdParamSchema.parse(req.params);
      const asset = await getPrisma().storeMediaAsset.findFirst({ where: { id, storeId } });
      if (!asset) throw notFound('Media not found');
      const absolute = path.join(storageRoot(), ...asset.storageKey.split('/'));
      try {
        await fs.access(absolute);
      } catch {
        throw notFound('File missing from storage');
      }
      res.setHeader('Content-Type', asset.mime);
      res.setHeader('Content-Length', String(asset.sizeBytes));
      if (asset.kind === 'DOCUMENT') {
        res.setHeader('Content-Disposition', `attachment; filename="${asset.fileName}"`);
      }
      createReadStream(absolute).pipe(res);
    } catch (err) {
      next(err);
    }
  },
];

const cleanupSchema = z.object({
  olderThanDays: z.coerce.number().int().min(0).max(365).default(30),
});

export const cleanupOrphansHandler = [
  requireSellerAuth,
  requireStoreAccess(STORE_PERMISSIONS.MEDIA_DELETE),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = getSellerAuth(req);
      const storeAuth = getStoreAuth(req);
      const { olderThanDays } = cleanupSchema.parse(req.query);
      res.json({
        success: true,
        data: await cleanupOrphans(
          storeAuth.storeId,
          auth.sellerId,
          await actorEmail(auth.sellerId),
          olderThanDays,
          getRequestMeta(req),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
];
