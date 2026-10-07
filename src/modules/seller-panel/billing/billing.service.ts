import { getPrisma } from '../../../config/db.js';

export async function listPlans() {
  const prisma = getPrisma();
  return prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: { pricePaise: 'asc' },
  });
}

export async function getCurrentSubscription(storeId: string) {
  const prisma = getPrisma();
  const sub = await prisma.storeSubscription.findFirst({
    where: { storeId },
    orderBy: { createdAt: 'desc' },
    include: { plan: true },
  });
  if (!sub) return null;
  return {
    id: sub.id,
    status: sub.status,
    billingCycle: sub.billingCycle,
    plan: {
      key: sub.plan.key,
      name: sub.plan.name,
      pricePaise: sub.plan.pricePaise,
      currency: sub.plan.currency,
      limits: sub.plan.limits,
    },
    trialStart: sub.trialStart,
    trialEnd: sub.trialEnd,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
  };
}
