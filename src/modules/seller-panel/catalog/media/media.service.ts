import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Prisma } from '../../../../generated/prisma/client.js';
import { getPrisma } from '../../../../config/db.js';
import { getEnv } from '../../../../config/env.js';
import { badRequest, conflict, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { recordStoreAudit } from '../../activity/store-audit.service.js';
import type { ListMediaInput, UpdateMediaInput, UploadMetaInput } from './media.schemas.js';

/**
 * Phase 1 · Module 1 — Media / Upload Service (local-driver MVP).
 *
 * Storage is behind this service on purpose: the local disk layout
 * (`<STORAGE_DIR>/{public,private}/stores/<storeId>/…`) mirrors the future
 * S3 layout (`{public,private}/stores/<storeId>/…`), so swapping the driver
 * later means changing `persistBuffer`/`removeStoredFile`/`publicUrlFor`,
 * not the API contract. Signed-URL direct-to-S3 upload slots into
 * `createUploadIntent` when credentials exist — until then the API accepts
 * multipart uploads and every mutating action writes to the store audit log.
 */

interface IncomingFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
]);
const VIDEO_MIMES = new Set(['video/mp4', 'video/webm']);
const DOCUMENT_MIMES = new Set(['application/pdf']);

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

// Extension allowlist — blocks double-extension tricks (.svg.exe) and
// executables masquerading with an image MIME type.
const ALLOWED_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'avif',
  'gif',
  'mp4',
  'webm',
  'pdf',
]);

const DEFAULT_QUOTA_MB = 100;

export function storageRoot(): string {
  return path.resolve(process.cwd(), getEnv().STORAGE_DIR);
}

export function classifyFile(mime: string, size: number): 'IMAGE' | 'VIDEO' | 'DOCUMENT' {
  if (IMAGE_MIMES.has(mime)) {
    if (size > MAX_IMAGE_BYTES) throw badRequest('Image exceeds 10 MB limit');
    return 'IMAGE';
  }
  if (VIDEO_MIMES.has(mime)) {
    if (size > MAX_VIDEO_BYTES) throw badRequest('Video exceeds 100 MB limit');
    return 'VIDEO';
  }
  if (DOCUMENT_MIMES.has(mime)) {
    if (size > MAX_DOCUMENT_BYTES) throw badRequest('Document exceeds 25 MB limit');
    return 'DOCUMENT';
  }
  throw badRequest(`Unsupported file type: ${mime}`);
}

export function sanitizeFileName(original: string): string {
  const base = path.basename(original).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  const ext = base.includes('.') ? (base.split('.').pop() ?? '').toLowerCase() : '';
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) throw badRequest('File extension not allowed');
  const stem = base.slice(0, base.length - ext.length - 1).slice(0, 150) || 'file';
  return `${stem}.${ext}`;
}

export function checksumOf(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** Plan quota in MB — active subscription wins, else the Free default. */
export async function getStorageQuotaMb(storeId: string): Promise<number> {
  const prisma = getPrisma();
  const sub = await prisma.storeSubscription.findFirst({
    where: { storeId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });
  const limits = (sub?.plan.limits ?? null) as Record<string, unknown> | null;
  const mb = limits != null && typeof limits['storage.mb'] === 'number' ? limits['storage.mb'] : null;
  return mb != null && mb > 0 ? Math.floor(mb) : DEFAULT_QUOTA_MB;
}

export async function getQuotaStatus(storeId: string): Promise<{
  usedBytes: number;
  limitBytes: number;
  percent: number;
  assetCount: number;
}> {
  const prisma = getPrisma();
  const [agg, assetCount, quotaMb] = await Promise.all([
    prisma.storeMediaAsset.aggregate({ where: { storeId }, _sum: { sizeBytes: true } }),
    prisma.storeMediaAsset.count({ where: { storeId } }),
    getStorageQuotaMb(storeId),
  ]);
  const usedBytes = agg._sum.sizeBytes ?? 0;
  const limitBytes = quotaMb * 1024 * 1024;
  return {
    usedBytes,
    limitBytes,
    percent: limitBytes === 0 ? 0 : Math.round((usedBytes / limitBytes) * 1000) / 10,
    assetCount,
  };
}

export async function listMedia(storeId: string, query: ListMediaInput) {
  const prisma = getPrisma();
  const where: Prisma.StoreMediaAssetWhereInput = { storeId };
  if (query.kind) where.kind = query.kind;
  if (query.folder) where.folder = query.folder;
  if (query.visibility) where.visibility = query.visibility;
  if (query.tag) where.tags = { has: query.tag };
  if (query.orphanOnly) where.usageCount = 0;
  if (query.search) {
    where.OR = [
      { originalName: { contains: query.search, mode: 'insensitive' } },
      { fileName: { contains: query.search, mode: 'insensitive' } },
      { altText: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  const [data, total] = await Promise.all([
    prisma.storeMediaAsset.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.storeMediaAsset.count({ where }),
  ]);
  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
}

function publicUrlFor(storageKey: string): string {
  // Static mount is `/uploads` → `<STORAGE_DIR>/public`, so the `public/`
  // scope prefix on the storage key must be stripped: the on-disk file
  // `public/stores/<id>/<file>` is served at `/uploads/stores/<id>/<file>`.
  const normalized = storageKey.split(path.sep).join('/');
  return `/uploads/${normalized.replace(/^(public|private)\//, '')}`;
}

export async function uploadMedia(
  storeId: string,
  sellerId: string,
  actorEmail: string | null,
  file: IncomingFile,
  meta: UploadMetaInput,
  reqMeta: RequestMeta,
): Promise<{ asset: unknown; deduped: boolean }> {
  if (!file.buffer || file.buffer.length === 0) throw badRequest('Empty file');
  if (file.size !== file.buffer.length) throw badRequest('File size mismatch');

  const kind = classifyFile(file.mimetype, file.buffer.length);
  const fileName = sanitizeFileName(file.originalname);
  // Documents are always private (expiring-link downloads, never CDN).
  const visibility = kind === 'DOCUMENT' ? 'PRIVATE' : meta.visibility;
  const checksum = checksumOf(file.buffer);

  const prisma = getPrisma();
  const existing = await prisma.storeMediaAsset.findUnique({
    where: { storeId_checksum: { storeId, checksum } },
  });
  if (existing) return { asset: existing, deduped: true };

  const quota = await getQuotaStatus(storeId);
  if (quota.usedBytes + file.buffer.length > quota.limitBytes) {
    throw conflict('Storage quota exceeded — delete unused assets or upgrade your plan');
  }

  const scope = visibility === 'PRIVATE' ? 'private' : 'public';
  const storageKey = path.join(scope, 'stores', storeId, `${randomUUID()}-${fileName}`);
  const absolute = path.join(storageRoot(), storageKey);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, file.buffer);

  try {
    const asset = await prisma.$transaction(async (tx) => {
      const created = await tx.storeMediaAsset.create({
        data: {
          storeId,
          fileName,
          originalName: file.originalname.slice(0, 255),
          mime: file.mimetype,
          sizeBytes: file.buffer.length,
          checksum,
          kind,
          visibility,
          status: 'READY',
          storageKey: storageKey.split(path.sep).join('/'),
          url: visibility === 'PUBLIC' ? publicUrlFor(storageKey) : null,
          folder: meta.folder,
          tags: meta.tags,
          altText: meta.altText ?? null,
          caption: meta.caption ?? null,
          uploadedBy: sellerId,
          metadata: {
            variants: ['original'],
            // Resize/WebP-AVIF pipeline (thumb, card, detail, zoom) runs
            // here once the image worker ships — URLs stay stable.
            variantsPending: kind === 'IMAGE',
          } as Prisma.InputJsonValue,
        },
      });
      await recordStoreAudit(tx, {
        storeId,
        actorId: sellerId,
        actorEmail,
        action: 'media.upload',
        resourceType: 'media',
        resourceId: created.id,
        metadata: { fileName, mime: file.mimetype, sizeBytes: file.buffer.length, kind },
        meta: reqMeta,
      });
      return created;
    });
    return { asset, deduped: false };
  } catch (err) {
    await fs.rm(absolute, { force: true });
    throw err;
  }
}

export async function updateMedia(
  storeId: string,
  id: string,
  sellerId: string,
  actorEmail: string | null,
  input: UpdateMediaInput,
  reqMeta: RequestMeta,
) {
  const prisma = getPrisma();
  const existing = await prisma.storeMediaAsset.findFirst({ where: { id, storeId } });
  if (!existing) throw notFound('Media not found');

  const data: Prisma.StoreMediaAssetUpdateInput = {};
  if (input.fileName !== undefined) {
    // Rename keeps the stored extension — only the stem is editable.
    const ext = existing.fileName.includes('.')
      ? existing.fileName.split('.').pop() ?? ''
      : '';
    const stem = input.fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!stem) throw badRequest('Invalid file name');
    data.fileName = ext ? `${stem.slice(0, 150)}.${ext}` : stem.slice(0, 150);
  }
  if (input.altText !== undefined) data.altText = input.altText;
  if (input.caption !== undefined) data.caption = input.caption;
  if (input.folder !== undefined) data.folder = input.folder;
  if (input.tags !== undefined) data.tags = input.tags;
  if (input.visibility !== undefined) {
    if (existing.kind === 'DOCUMENT' && input.visibility === 'PUBLIC') {
      throw badRequest('Documents must stay private');
    }
    data.visibility = input.visibility;
    data.url = input.visibility === 'PUBLIC' ? publicUrlFor(existing.storageKey) : null;
    if (input.visibility !== existing.visibility) {
      await moveStoredFile(existing.storageKey, input.visibility, storeId);
      data.storageKey = storageKeyFor(input.visibility, storeId, existing.storageKey);
    }
  }

  const before = {
    fileName: existing.fileName,
    altText: existing.altText,
    caption: existing.caption,
    folder: existing.folder,
    tags: existing.tags,
    visibility: existing.visibility,
  };
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.storeMediaAsset.update({ where: { id }, data });
    await recordStoreAudit(tx, {
      storeId,
      actorId: sellerId,
      actorEmail,
      action: 'media.update',
      resourceType: 'media',
      resourceId: id,
      metadata: { before, after: input },
      meta: reqMeta,
    });
    return row;
  });
  return updated;
}

function storageKeyFor(visibility: 'PUBLIC' | 'PRIVATE', _storeId: string, oldKey: string): string {
  const scope = visibility === 'PUBLIC' ? 'public' : 'private';
  return oldKey.replace(/^(public|private)\//, `${scope}/`);
}

async function moveStoredFile(oldKey: string, visibility: 'PUBLIC' | 'PRIVATE', storeId: string) {
  const nextKey = storageKeyFor(visibility, storeId, oldKey);
  if (nextKey === oldKey) return;
  const from = path.join(storageRoot(), ...oldKey.split('/'));
  const to = path.join(storageRoot(), ...nextKey.split('/'));
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rename(from, to);
}

export async function deleteMedia(
  storeId: string,
  id: string,
  sellerId: string,
  actorEmail: string | null,
  reqMeta: RequestMeta,
): Promise<void> {
  const prisma = getPrisma();
  const existing = await prisma.storeMediaAsset.findFirst({ where: { id, storeId } });
  if (!existing) throw notFound('Media not found');
  if (existing.usageCount > 0) {
    throw conflict(
      `Asset is used in ${existing.usageCount} place(s) — remove it from those listings first`,
    );
  }
  await prisma.$transaction(async (tx) => {
    await tx.storeMediaAsset.delete({ where: { id } });
    await recordStoreAudit(tx, {
      storeId,
      actorId: sellerId,
      actorEmail,
      action: 'media.delete',
      resourceType: 'media',
      resourceId: id,
      metadata: { fileName: existing.fileName, sizeBytes: existing.sizeBytes },
      meta: reqMeta,
    });
  });
  await fs.rm(path.join(storageRoot(), ...existing.storageKey.split('/')), { force: true });
}

/** Orphan cleanup: unreferenced assets older than `olderThanDays`. */
export async function cleanupOrphans(
  storeId: string,
  sellerId: string,
  actorEmail: string | null,
  olderThanDays: number,
  reqMeta: RequestMeta,
): Promise<{ deleted: number; freedBytes: number }> {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0 || olderThanDays > 365) {
    throw badRequest('olderThanDays must be 0–365');
  }
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const orphans = await prisma.storeMediaAsset.findMany({
    where: { storeId, usageCount: 0, createdAt: { lt: cutoff } },
    select: { id: true, storageKey: true, sizeBytes: true, fileName: true },
  });
  let freedBytes = 0;
  for (const orphan of orphans) {
    await prisma.$transaction(async (tx) => {
      await tx.storeMediaAsset.delete({ where: { id: orphan.id } });
      await recordStoreAudit(tx, {
        storeId,
        actorId: sellerId,
        actorEmail,
        action: 'media.delete',
        resourceType: 'media',
        resourceId: orphan.id,
        metadata: { fileName: orphan.fileName, reason: 'orphan-cleanup' },
        meta: reqMeta,
      });
    });
    await fs.rm(path.join(storageRoot(), ...orphan.storageKey.split('/')), { force: true });
    freedBytes += orphan.sizeBytes;
  }
  return { deleted: orphans.length, freedBytes };
}

/**
 * Usage counter for the product module (Module 6+): call when an asset is
 * attached/detached so delete-protection and orphan cleanup stay correct.
 */
export async function adjustUsage(
  storeId: string,
  assetIds: string[],
  delta: 1 | -1,
): Promise<void> {
  if (assetIds.length === 0) return;
  const prisma = getPrisma();
  if (delta === 1) {
    await prisma.storeMediaAsset.updateMany({
      where: { storeId, id: { in: assetIds } },
      data: { usageCount: { increment: 1 } },
    });
  } else {
    await prisma.storeMediaAsset.updateMany({
      where: { storeId, id: { in: assetIds } },
      data: { usageCount: { decrement: 1 } },
    });
    // Clamp at zero — concurrent detaches must never drive the counter negative.
    await prisma.storeMediaAsset.updateMany({
      where: { storeId, id: { in: assetIds }, usageCount: { lt: 0 } },
      data: { usageCount: 0 },
    });
  }
}
