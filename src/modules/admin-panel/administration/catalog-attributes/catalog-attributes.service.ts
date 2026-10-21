import type { Prisma } from '../../../../generated/prisma/client.js';
import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { recordAudit } from '../../../audit/audit.service.js';
import { slugify } from '../categories/categories.service.js';
import type {
  CreateProductAttributeInput,
  CreateProductAttributeOptionInput,
  ProductAttributeType,
  SuggestReviewInput,
  UpdateProductAttributeInput,
  UpdateProductAttributeOptionInput,
} from './catalog-attributes.schemas.js';

/**
 * Phase 1 — Module 4 — product attribute catalog (admin-owned).
 *
 * Rules enforced here:
 * - `code` is the machine key stored on product values; it is minted once
 *   (from the slugged name or an explicit input) and immutable afterwards.
 * - Type is changeable until products consume the attribute values; the
 *   usage gate stays a no-op until the Module 6 product-value table lands
 *   (the guard hook is centralised in `productsUsingAttribute`).
 * - Option values must be unique among ACTIVE rows per attribute; seller
 *   suggestions (SUGGESTED) enter the approval queue and only become
 *   selectable after an admin approves them.
 * - Deleting an attribute is blocked while a set still references it.
 */

type Db = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

function clean<T extends string>(v: T | undefined): T | undefined {
  return v === undefined ? undefined : (v.trim() as T | undefined);
}

const nullIfEmpty = (v: string | undefined | null): string | null =>
  (v === undefined ? undefined : (clean(v ?? '') ?? null)) ?? null;

async function productsUsingAttribute(client: Db, attributeId: string): Promise<number> {
  // Module 6 will count product_attribute_values here (per store + value
  // rows). Until that table exists no product can reference an attribute,
  // so the usage count is structurally zero.
  void client;
  void attributeId;
  return 0;
}

function guardOptionType(type: ProductAttributeType, isCreate: boolean): void {
  const valueKeyed = ['DROPDOWN', 'MULTI_SELECT', 'COLOR_SWATCH', 'IMAGE_SWATCH'];
  if (!valueKeyed.includes(type)) {
    if (isCreate) return;
    throw conflict(`Attribute type ${type} does not take option values`);
  }
}

async function assertActiveValueAvailable(
  client: Db,
  attributeId: string,
  value: string,
  exceptOptionId?: string,
): Promise<void> {
  const db = client as Prisma.TransactionClient;
  const dup = await db.productAttributeOption.findFirst({
    where: {
      attributeId,
      value,
      status: 'ACTIVE',
      ...(exceptOptionId ? { id: { not: exceptOptionId } } : {}),
    },
    select: { id: true },
  });
  if (dup) throw conflict(`Option value "${value}" already exists for this attribute`);
}

async function getLiveAttribute(client: Db, id: string) {
  const db = client as Prisma.TransactionClient;
  const row = await db.productAttribute.findUnique({ where: { id } });
  if (!row || row.deletedAt) throw notFound('Attribute not found');
  return row;
}

export async function listProductAttributes(query: {
  page: number;
  limit: number;
  search?: string | undefined;
  status?: 'ACTIVE' | 'INACTIVE' | undefined;
  type?: ProductAttributeType | undefined;
  includeDeleted: boolean;
}) {
  const prisma = getPrisma();
  const where: Prisma.ProductAttributeWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.includeDeleted ? {} : { deletedAt: null }),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.productAttribute.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      include: {
        _count: { select: { options: true, items: true } },
      },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.productAttribute.count({ where }),
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

export async function getProductAttribute(id: string) {
  const prisma = getPrisma();
  const row = await prisma.productAttribute.findUnique({
    where: { id },
    include: {
      options: {
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      },
      items: {
        include: {
          attributeSet: { select: { id: true, name: true, slug: true, status: true } },
        },
        orderBy: [{ displayOrder: 'asc' }],
      },
    },
  });
  if (!row || row.deletedAt) throw notFound('Attribute not found');
  return row;
}

export async function createProductAttribute(
  input: CreateProductAttributeInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    // Attribute codes are snake_case machine keys (slugify yields hyphens).
    const code = input.code ?? slugify(input.name).replace(/-/g, '_');
    const existing = await tx.productAttribute.findUnique({
      where: { code },
      select: { id: true },
    });
    if (existing) throw conflict(`Attribute code "${code}" is already taken`);

    // Options only apply to value-keyed types.
    guardOptionType(input.type, true);
    const OPTION_TYPES = ['DROPDOWN', 'MULTI_SELECT', 'COLOR_SWATCH', 'IMAGE_SWATCH'] as const;
    const options = OPTION_TYPES.includes(input.type as (typeof OPTION_TYPES)[number])
      ? input.options
      : [];

    if (options.length > 0) {
      for (const option of options) {
        if (option.swatchHex && option.imageUrl) {
          throw badRequest('Option cannot carry both swatchHex and imageUrl');
        }
        if (input.type === 'COLOR_SWATCH' && !option.swatchHex && !option.imageUrl) {
          throw badRequest('Colour swatch options require swatchHex');
        }
        if (input.type === 'IMAGE_SWATCH' && !option.imageUrl) {
          throw badRequest('Image swatch options require imageUrl');
        }
      }
      const seen = new Set<string>();
      for (const option of options) {
        const key = option.value.toLowerCase();
        if (seen.has(key)) {
          throw conflict(`Duplicate option value "${option.value}" in inline options`);
        }
        seen.add(key);
      }
    }

    const created = await tx.productAttribute.create({
      data: {
        name: input.name.trim(),
        code,
        type: input.type,
        unit: nullIfEmpty(input.unit),
        helpText: nullIfEmpty(input.helpText),
        required: input.required,
        filterable: input.filterable,
        searchable: input.searchable,
        comparable: input.comparable,
        variantDefining: input.variantDefining,
        visibleOnPage: input.visibleOnPage,
        validationMin: input.validationMin ?? null,
        validationMax: input.validationMax ?? null,
        validationRegex: nullIfEmpty(input.validationRegex),
        allowedUnits: input.allowedUnits,
        options: {
          create: options.map((option) => ({
            label: option.label.trim(),
            value: option.value.trim(),
            swatchHex: option.swatchHex ?? null,
            imageUrl: option.imageUrl ?? null,
            displayOrder: option.displayOrder,
          })),
        },
      },
      include: { options: true },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'product_attribute.created',
      resourceType: 'product_attribute',
      resourceId: created.id,
      after: {
        name: created.name,
        code,
        type: created.type,
        optionsSeeded: options.length,
      },
      meta,
    });
    return created;
  });
}

export async function updateProductAttribute(
  id: string,
  input: UpdateProductAttributeInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await getLiveAttribute(prisma, id);

  let typeChangedTo: ProductAttributeType | null = null;
  if (input.type !== undefined && input.type !== row.type) {
    const usage = await productsUsingAttribute(prisma, id);
    if (usage > 0) {
      throw conflict(
        `Attribute type cannot change: ${usage} product value(s) already reference this attribute`,
      );
    }
    guardOptionType(input.type, false);
    typeChangedTo = input.type;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.productAttribute.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(typeChangedTo ? { type: typeChangedTo } : {}),
        ...(input.unit !== undefined ? { unit: nullIfEmpty(input.unit) } : {}),
        ...(input.helpText !== undefined ? { helpText: nullIfEmpty(input.helpText) } : {}),
        ...(input.required !== undefined ? { required: input.required } : {}),
        ...(input.filterable !== undefined ? { filterable: input.filterable } : {}),
        ...(input.searchable !== undefined ? { searchable: input.searchable } : {}),
        ...(input.comparable !== undefined ? { comparable: input.comparable } : {}),
        ...(input.variantDefining !== undefined ? { variantDefining: input.variantDefining } : {}),
        ...(input.visibleOnPage !== undefined ? { visibleOnPage: input.visibleOnPage } : {}),
        ...(input.validationMin !== undefined ? { validationMin: input.validationMin } : {}),
        ...(input.validationMax !== undefined ? { validationMax: input.validationMax } : {}),
        ...(input.validationRegex !== undefined
          ? { validationRegex: nullIfEmpty(input.validationRegex) }
          : {}),
        ...(input.allowedUnits !== undefined ? { allowedUnits: input.allowedUnits } : {}),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'product_attribute.updated',
      resourceType: 'product_attribute',
      resourceId: id,
      before: { type: row.type, name: row.name },
      after: {
        name: updated.name,
        ...(typeChangedTo ? { type: typeChangedTo } : {}),
        typeChanged: Boolean(typeChangedTo),
      },
      meta,
    });
    return updated;
  });
}

export async function setProductAttributeStatus(
  id: string,
  status: 'ACTIVE' | 'INACTIVE',
  reason: string,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await getLiveAttribute(prisma, id);
  if (row.status === status) throw badRequest(`Attribute is already ${status}`);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.productAttribute.update({ where: { id }, data: { status } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'product_attribute.status_changed',
      resourceType: 'product_attribute',
      resourceId: id,
      before: { status: row.status },
      // Deactivation hides the attribute from new set attachments + forms.
      after: { status, reason },
      meta,
    });
    return updated;
  });
}

export async function deleteProductAttribute(
  id: string,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const row = await getLiveAttribute(prisma, id);
  const usage = await productsUsingAttribute(prisma, id);
  if (usage > 0) {
    throw conflict(`Attribute has been used by ${usage} product value(s) and cannot be deleted`);
  }
  return prisma.$transaction(async (tx) => {
    const linkedSets = await tx.productAttributeSetItem.count({ where: { attributeId: id } });
    if (linkedSets > 0) {
      throw conflict(
        `Attribute is still referenced by ${linkedSets} attribute-set rows — remove it from the sets first`,
      );
    }
    const deleted = await tx.productAttribute.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: 'INACTIVE',
        items: { deleteMany: {} },
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'product_attribute.deleted',
      resourceType: 'product_attribute',
      resourceId: id,
      before: { name: row.name, code: row.code },
      after: { deletedAt: deleted.deletedAt?.toISOString() ?? null },
      meta,
    });
    return { id: deleted.id, deletedAt: deleted.deletedAt };
  });
}

// ─── Option management ─────────────────────────────────────────────────────

const OPTION_TYPES: readonly ProductAttributeType[] = [
  'DROPDOWN',
  'MULTI_SELECT',
  'COLOR_SWATCH',
  'IMAGE_SWATCH',
];

export async function addOption(
  attributeId: string,
  input: CreateProductAttributeOptionInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const attribute = await getLiveAttribute(prisma, attributeId);
  if (!OPTION_TYPES.includes(attribute.type)) {
    throw conflict(`Attribute type ${attribute.type} does not take option values`);
  }
  if (attribute.type === 'COLOR_SWATCH' && !input.swatchHex) {
    throw badRequest('Colour swatch options require swatchHex');
  }
  if (attribute.type === 'IMAGE_SWATCH' && !input.imageUrl) {
    throw badRequest('Image swatch options require imageUrl');
  }
  return prisma.$transaction(async (tx) => {
    await assertActiveValueAvailable(tx, attributeId, input.value.trim());
    const created = await tx.productAttributeOption.create({
      data: {
        attributeId,
        label: input.label.trim(),
        value: input.value.trim(),
        swatchHex: input.swatchHex ?? null,
        imageUrl: input.imageUrl ?? null,
        displayOrder: input.displayOrder,
        status: 'ACTIVE',
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'product_attribute_option.created',
      resourceType: 'product_attribute_option',
      resourceId: created.id,
      after: { attributeId, label: created.label, value: created.value },
      meta,
    });
    return created;
  });
}

export async function updateOption(
  attributeId: string,
  optionId: string,
  input: UpdateProductAttributeOptionInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  await getLiveAttribute(prisma, attributeId);
  const option = await prisma.productAttributeOption.findUnique({ where: { id: optionId } });
  if (!option || option.attributeId !== attributeId) throw notFound('Option not found');
  if (input.status === 'SUGGESTED' && option.status !== 'SUGGESTED') {
    throw badRequest('SUGGESTED is a queue state — approve or reject suggestions instead');
  }

  return prisma.$transaction(async (tx) => {
    if (input.value !== undefined && input.value.trim() !== option.value) {
      await assertActiveValueAvailable(tx, attributeId, input.value.trim(), optionId);
    }
    const nextStatus = input.status ?? option.status;
    const nextValue = input.value !== undefined ? input.value.trim() : option.value;
    if (nextStatus === 'ACTIVE') {
      await assertActiveValueAvailable(tx, attributeId, nextValue, optionId);
    }
    const updated = await tx.productAttributeOption.update({
      where: { id: optionId },
      data: {
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.value !== undefined ? { value: nextValue } : {}),
        ...(input.swatchHex !== undefined ? { swatchHex: input.swatchHex } : {}),
        ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'product_attribute_option.updated',
      resourceType: 'product_attribute_option',
      resourceId: optionId,
      before: { value: option.value, status: option.status },
      after: { value: updated.value, status: updated.status },
      meta,
    });
    return updated;
  });
}

export async function reorderOptions(
  attributeId: string,
  orders: Array<{ id: string; displayOrder: number }>,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  await getLiveAttribute(prisma, attributeId);
  const ids = orders.map((o) => o.id);
  if (new Set(ids).size !== ids.length) throw badRequest('Duplicate option ids in reorder payload');
  const rows = await prisma.productAttributeOption.findMany({
    where: { id: { in: ids }, attributeId },
    select: { id: true },
  });
  if (rows.length !== ids.length)
    throw notFound('One or more options do not belong to this attribute');

  return prisma.$transaction(async (tx) => {
    for (const order of orders) {
      await tx.productAttributeOption.update({
        where: { id: order.id },
        data: { displayOrder: order.displayOrder },
      });
    }
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'product_attribute_options.reordered',
      resourceType: 'product_attribute',
      resourceId: attributeId,
      after: { orders },
      meta,
    });
    return { attributeId, reordered: orders.length };
  });
}

export async function deleteOption(
  attributeId: string,
  optionId: string,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  await getLiveAttribute(prisma, attributeId);
  const option = await prisma.productAttributeOption.findUnique({ where: { id: optionId } });
  if (!option || option.attributeId !== attributeId) throw notFound('Option not found');

  const usage = await productsUsingAttribute(prisma, attributeId);
  if (usage > 0) {
    // Module 6 tightens this: "delete with replacement mapping" swaps every
    // product value referencing this option before removal. Until products
    // exist, options cannot be in use and delete directly.
    throw conflict('Options cannot be deleted while product values exist for the attribute');
  }

  return prisma.$transaction(async (tx) => {
    await tx.productAttributeOption.delete({ where: { id: optionId } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'product_attribute_option.deleted',
      resourceType: 'product_attribute_option',
      resourceId: optionId,
      before: { attributeId, value: option.value, status: option.status },
      after: { deleted: true },
      meta,
    });
    return { id: optionId, deleted: true };
  });
}

// ─── Seller suggestion queue ───────────────────────────────────────────────

export async function listOptionSuggestions(query: {
  page: number;
  limit: number;
  attributeId?: string | undefined;
}) {
  const prisma = getPrisma();
  const where: Prisma.ProductAttributeOptionWhereInput = {
    status: 'SUGGESTED',
    ...(query.attributeId ? { attributeId: query.attributeId } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.productAttributeOption.findMany({
      where,
      include: {
        attribute: { select: { id: true, name: true, code: true, type: true } },
      },
      orderBy: { createdAt: 'asc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.productAttributeOption.count({ where }),
  ]);
  return { data, total };
}

export async function reviewSuggestion(
  optionId: string,
  input: SuggestReviewInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const option = await prisma.productAttributeOption.findUnique({ where: { id: optionId } });
  if (!option) throw notFound('Suggestion not found');
  if (option.status !== 'SUGGESTED') throw badRequest('Suggestion already reviewed');

  return prisma.$transaction(async (tx) => {
    if (input.decision === 'APPROVED') {
      // Approve = make the value selectable; a live ACTIVE duplicate blocks.
      const dup = await tx.productAttributeOption.findFirst({
        where: {
          attributeId: option.attributeId,
          value: option.value,
          status: 'ACTIVE',
          id: { not: optionId },
        },
        select: { id: true },
      });
      if (dup) {
        // Someone else already created the canonical row — keep this queue
        // clean by removing the duplicate suggestion.
        await tx.productAttributeOption.delete({ where: { id: optionId } });
        await recordAudit(tx, {
          actorId: actor.adminId,
          action: 'product_attribute_suggestion.approved_duplicate',
          resourceType: 'product_attribute_option',
          resourceId: optionId,
          before: { status: 'SUGGESTED' },
          after: { outcome: 'duplicate_removed', canonicalOptionId: dup.id },
          meta,
        });
        return { id: optionId, outcome: 'REMOVED_AS_DUPLICATE' as const };
      }
      const updated = await tx.productAttributeOption.update({
        where: { id: optionId },
        data: { status: 'ACTIVE' },
      });
      await recordAudit(tx, {
        actorId: actor.adminId,
        action: 'product_attribute_suggestion.approved',
        resourceType: 'product_attribute_option',
        resourceId: optionId,
        before: { status: 'SUGGESTED' },
        after: {
          status: 'ACTIVE',
          value: updated.value,
          reviewNote: input.reviewNote ?? null,
        },
        meta,
      });
      return updated;
    }
    // Rejected suggestions are removed; seller can re-suggest later.
    await tx.productAttributeOption.delete({ where: { id: optionId } });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'product_attribute_suggestion.rejected',
      resourceType: 'product_attribute_option',
      resourceId: optionId,
      before: { status: 'SUGGESTED', value: option.value },
      after: { decision: 'REJECTED', reviewNote: input.reviewNote ?? null },
      meta,
    });
    return { id: optionId, outcome: 'REJECTED' as const };
  });
}
