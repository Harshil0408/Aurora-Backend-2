import { getPrisma } from '../../../../config/db.js';
import type { RequestMeta } from '../../../../shared/utils/requestMeta.js';
import { recordAudit } from '../../../audit/audit.service.js';
import type { UpdateSettingsInput } from './commerce-settings.schemas.js';

/**
 * Phase 1 — Module 5 — commerce settings singleton (admin-owned).
 * Created lazily on first read so the platform boots with sane defaults
 * (false / INR / INR / NONE) without needing a seed step.
 */
export async function getSettings() {
  const prisma = getPrisma();
  return prisma.commerceSettings.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {},
  });
}

export async function updateSettings(
  input: UpdateSettingsInput,
  actor: { adminId: string },
  meta: RequestMeta,
) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const before = await getSettings();
    const updated = await tx.commerceSettings.upsert({
      where: { id: 'singleton' },
      update: {
        ...(input.priceIncludesTax !== undefined
          ? { priceIncludesTax: input.priceIncludesTax }
          : {}),
        ...(input.baseCurrency !== undefined ? { baseCurrency: input.baseCurrency } : {}),
        ...(input.displayCurrency !== undefined ? { displayCurrency: input.displayCurrency } : {}),
        ...(input.roundingMode !== undefined ? { roundingMode: input.roundingMode } : {}),
        updatedById: actor.adminId,
      },
      create: {
        id: 'singleton',
        ...(input.priceIncludesTax !== undefined
          ? { priceIncludesTax: input.priceIncludesTax }
          : {}),
        ...(input.baseCurrency !== undefined ? { baseCurrency: input.baseCurrency } : {}),
        ...(input.displayCurrency !== undefined ? { displayCurrency: input.displayCurrency } : {}),
        ...(input.roundingMode !== undefined ? { roundingMode: input.roundingMode } : {}),
        updatedById: actor.adminId,
      },
    });
    await recordAudit(tx, {
      actorId: actor.adminId,
      action: 'commerce_settings.updated',
      resourceType: 'commerce_settings',
      resourceId: 'singleton',
      before: {
        priceIncludesTax: before.priceIncludesTax,
        baseCurrency: before.baseCurrency,
        displayCurrency: before.displayCurrency,
        roundingMode: before.roundingMode,
      },
      after: {
        priceIncludesTax: updated.priceIncludesTax,
        baseCurrency: updated.baseCurrency,
        displayCurrency: updated.displayCurrency,
        roundingMode: updated.roundingMode,
      },
      meta,
    });
    return updated;
  });
}

/**
 * Effective inclusive-tax decision for a store: the store override (when
 * non-null) wins, otherwise the platform default. The store params arrive
 * with the store account; pass null when unknown (platform-only context).
 */
export function resolveInclusiveForStore(
  settings: { priceIncludesTax: boolean },
  store: { priceIncludesTax: boolean | null } | null,
): boolean {
  if (store && store.priceIncludesTax !== null) return store.priceIncludesTax;
  return settings.priceIncludesTax;
}
