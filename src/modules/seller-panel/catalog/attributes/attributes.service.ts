import { getPrisma } from '../../../../config/db.js';
import { badRequest, conflict, notFound } from '../../../../shared/errors/AppError.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { recordStoreAudit } from '../../activity/store-audit.service.js';
import type { SuggestOptionInput } from './attributes.schemas.js';

/**
 * Phase 1 — Module 4 — seller face of the product attribute system.
 *
 * Sellers do NOT own attributes: they
 * 1. read the resolved attribute set for a category (product form source of
 *    truth — categories inherit the nearest ancestor's set), and
 * 2. propose NEW option values (dropdowns/swatches) which enter the admin
 *    approval queue as SUGGESTED rows carrying store provenance. Only
 *    admin approval makes a suggested value selectable.
 */

const OPTION_TYPES = ['DROPDOWN', 'MULTI_SELECT', 'COLOR_SWATCH', 'IMAGE_SWATCH'] as const;

type SetPayload = Awaited<ReturnType<typeof getAttributeSetPayload>>;

interface ResolvedSet {
  resolvedFrom: 'category' | 'inherited';
  categoryId: string | null;
  set: SetPayload | null;
}

async function getAttributeSetPayload(setId: string) {
  const prisma = getPrisma();
  return prisma.productAttributeSet.findUnique({
    where: { id: setId },
    include: {
      items: {
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          group: { select: { id: true, name: true, displayOrder: true } },
          attribute: {
            include: {
              options: {
                where: { status: 'ACTIVE' },
                orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
              },
            },
          },
        },
      },
      groups: {
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        where: { items: { some: {} } },
      },
    },
  });
}

export async function resolveCategoryAttributeSet(
  _storeId: string,
  categoryId: string,
): Promise<ResolvedSet> {
  const prisma = getPrisma();
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, parentId: true, attributeSetId: true, deletedAt: true, status: true },
  });
  if (!category || category.deletedAt) throw notFound('Category not found');
  if (category.status !== 'ACTIVE') throw badRequest('Category is not ACTIVE');

  // Own set wins; otherwise walk the ANCESTOR chain (Module 4 spec:
  // "one set per category, inherited down the tree").
  let setId = category.attributeSetId;
  let resolvedFrom: ResolvedSet['resolvedFrom'] = 'category';
  if (!setId) {
    let cursorId: string | null = category.parentId ?? null;
    const seen = new Set<string>();
    while (cursorId && !seen.has(cursorId)) {
      seen.add(cursorId);
      const parent = await prisma.category.findUnique({
        where: { id: cursorId },
        select: { parentId: true, attributeSetId: true, deletedAt: true },
      });
      if (!parent) break;
      if (parent.attributeSetId && !parent.deletedAt) {
        setId = parent.attributeSetId;
        resolvedFrom = 'inherited';
        break;
      }
      cursorId = parent.parentId ?? null;
    }
  }

  if (!setId) {
    return { resolvedFrom, categoryId: null, set: null };
  }
  const set = await getAttributeSetPayload(setId);
  if (!set) {
    // Assigned set was deleted/deactivated server-side — treat as no set.
    return { resolvedFrom, categoryId: null, set: null };
  }
  return { resolvedFrom, categoryId: setId, set };
}

export async function suggestOption(
  storeId: string,
  sellerId: string,
  sellerEmail: string | null,
  attributeId: string,
  input: SuggestOptionInput,
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  const attribute = await prisma.productAttribute.findUnique({ where: { id: attributeId } });
  if (!attribute || attribute.deletedAt) throw notFound('Attribute not found');
  if (attribute.status !== 'ACTIVE') throw badRequest('Attribute is not ACTIVE');
  if (!OPTION_TYPES.includes(attribute.type as (typeof OPTION_TYPES)[number])) {
    throw conflict(`Attribute type ${attribute.type} does not take option suggestions`);
  }
  if (attribute.type === 'COLOR_SWATCH' && !input.swatchHex && !input.imageUrl) {
    throw badRequest('Colour swatch suggestions require swatchHex');
  }
  if (attribute.type === 'IMAGE_SWATCH' && !input.imageUrl) {
    throw badRequest('Image swatch suggestions require imageUrl');
  }

  return prisma.$transaction(async (tx) => {
    const activeDup = await tx.productAttributeOption.findFirst({
      where: { attributeId, value: input.value.trim(), status: 'ACTIVE' },
      select: { id: true },
    });
    if (activeDup) {
      throw conflict(`Value "${input.value.trim()}" is already available for this attribute`);
    }
    const duplicate = await tx.productAttributeOption.findFirst({
      where: {
        attributeId,
        value: input.value.trim(),
        status: 'SUGGESTED',
        suggestedByStoreId: storeId,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw conflict('You already have a pending suggestion with this value');
    }
    const created = await tx.productAttributeOption.create({
      data: {
        attributeId,
        label: (input.label?.trim() || input.value.trim()).slice(0, 128),
        value: input.value.trim(),
        swatchHex: input.swatchHex ?? null,
        imageUrl: input.imageUrl ?? null,
        status: 'SUGGESTED',
        suggestedByStoreId: storeId,
        suggestedBySellerId: sellerId,
      },
    });
    await recordStoreAudit(tx, {
      storeId,
      actorId: sellerId,
      actorEmail: sellerEmail,
      action: 'attribute_option.suggested',
      resourceType: 'product_attribute_option',
      resourceId: created.id,
      metadata: {
        attributeId,
        attributeName: attribute.name,
        value: created.value,
      },
      meta,
    });
    return created;
  });
}
