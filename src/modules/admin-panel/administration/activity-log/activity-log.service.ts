import { getPrisma } from '../../../../config/db.js';
import type { Prisma as PrismaTypes } from '../../../../generated/prisma/client.js';
import { badRequest, notFound } from '../../../../shared/errors/AppError.js';

export interface AuditLogQuery {
  page: number;
  limit: number;
  action?: string | undefined;
  resourceType?: string | undefined;
  resourceId?: string | undefined;
}

export async function queryAuditLog(
  query: AuditLogQuery,
): Promise<{ data: unknown[]; total: number }> {
  const prisma = getPrisma();
  const where: { action?: string; resourceType?: string; resourceId?: string } = {};
  if (query.action) where.action = query.action;
  if (query.resourceType) where.resourceType = query.resourceType;
  if (query.resourceId) where.resourceId = query.resourceId;
  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.adminAuditLog.count({ where }),
  ]);
  return {
    data: rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      before: r.before,
      after: r.after,
      ipAddress: r.ipAddress,
      requestId: r.requestId,
      createdAt: r.createdAt,
    })),
    total,
  };
}

// ---------------------------------------------------------------------------
// Activity feed (GET /admin/activity*): presentation layer over the raw
// audit trail. Stored action names are NEVER renamed (history is immutable);
// they are mapped to stable feed keys + labels here, so the UI gets a fixed
// contract while writers keep appending freely.
// ---------------------------------------------------------------------------

export interface ActivityChange {
  field: string;
  before: string;
  after: string;
}

export interface ActivityEntry {
  id: string;
  timestamp: Date;
  action: string;
  actionLabel: string;
  category: string;
  actor: { id: string; email: string; name: string };
  resource: { type: string; id: string; label: string };
  ip: string;
  userAgent: string | null;
  changes: ActivityChange[];
  requestId: string;
}

export interface ActionOption {
  action: string;
  label: string;
  category: string;
  count: number;
}

interface FeedActionDef {
  key: string;
  label: string;
  category: string;
}

/** Feed contract: the fixed machine keys, labels, and groups the UI renders. */
export const FEED_ACTIONS: FeedActionDef[] = [
  { key: 'admin.created', label: 'Admin created', category: 'Admins' },
  { key: 'admin.status_changed', label: 'Status changed', category: 'Admins' },
  { key: 'admin.roles_updated', label: 'Roles assigned', category: 'Admins' },
  { key: 'admin.sessions_revoked', label: 'Sessions revoked', category: 'Admins' },
  { key: 'role.created', label: 'Role created', category: 'Roles' },
  { key: 'role.cloned', label: 'Role cloned', category: 'Roles' },
  { key: 'role.updated', label: 'Role updated', category: 'Roles' },
  { key: 'role.status_changed', label: 'Status changed', category: 'Roles' },
  { key: 'role.deleted', label: 'Role deleted', category: 'Roles' },
  { key: 'role.permissions_updated', label: 'Role updated', category: 'Roles' },
  { key: 'role.permissions_granted', label: 'Role updated', category: 'Roles' },
  { key: 'role.permissions_revoked', label: 'Role updated', category: 'Roles' },
  { key: 'permission.defined', label: 'Permission defined', category: 'Roles' },
  { key: 'permission.updated', label: 'Permission updated', category: 'Roles' },
  { key: 'permission.status_changed', label: 'Status changed', category: 'Roles' },
  { key: 'permission.deleted', label: 'Permission deleted', category: 'Roles' },
];

/** Stored audit action -> feed key. Unknown actions surface under their own key (category Other). */
const STORED_TO_FEED: Record<string, string> = {
  'admin.create': 'admin.created',
  'admin.bootstrap': 'admin.created',
  'admin.suspend': 'admin.status_changed',
  'role.assign': 'admin.roles_updated',
  'session.revoke': 'admin.sessions_revoked',
  'role.create': 'role.created',
  'role.clone': 'role.cloned',
  'role.update': 'role.updated',
  'role.activate': 'role.status_changed',
  'role.deactivate': 'role.status_changed',
  'role.delete': 'role.deleted',
  'role.permissions_updated': 'role.permissions_updated',
  'role.permissions.add': 'role.permissions_granted',
  'role.permissions.remove': 'role.permissions_revoked',
  'permission.create': 'permission.defined',
  'permission.update': 'permission.updated',
  'permission.activate': 'permission.status_changed',
  'permission.deactivate': 'permission.status_changed',
  'permission.delete': 'permission.deleted',
};

const FEED_BY_KEY = new Map(FEED_ACTIONS.map((d) => [d.key, d]));

function payloadHas(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && key in value;
}

/**
 * Resolve a stored row to its feed key. Legacy 'role.update' rows are
 * disambiguated by payload: grant replacements carry a `permissions`
 * snapshot, rename edits carry `name`/`description`.
 */
export function mapStoredAction(stored: string, before: unknown, after: unknown): string {
  if (
    stored === 'role.update' &&
    (payloadHas(before, 'permissions') || payloadHas(after, 'permissions'))
  ) {
    return 'role.permissions_updated';
  }
  return STORED_TO_FEED[stored] ?? stored;
}

/** Feed keys back to stored actions for filtering. Unknown values pass through literally (match nothing). */
export function specKeyToStored(spec: string): string[] {
  if (spec === 'role.permissions_updated') {
    // Inclusive: pre-rename grant rows are stored as 'role.update'.
    return ['role.permissions_updated', 'role.update'];
  }
  if (spec === 'role.updated') return ['role.update'];
  const hit = Object.entries(STORED_TO_FEED)
    .filter(([, feed]) => feed === spec)
    .map(([stored]) => stored);
  return hit.length > 0 ? hit : [spec];
}

const DISPLAY_MAX = 120;

function formatDisplay(value: unknown): string {
  if (value === null || value === undefined) return '—';
  let s: string;
  if (Array.isArray(value)) {
    if (value.length === 0) return '—';
    s = value.map((v) => String(v)).join(', ');
  } else if (typeof value === 'object') {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  return s.length > DISPLAY_MAX ? `${s.slice(0, DISPLAY_MAX - 1)}…` : s;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Before/after snapshots -> per-field display rows (pre-formatted, UI renders
 * verbatim). Unchanged fields are omitted — a row means something moved.
 */
export function deriveChanges(before: unknown, after: unknown): ActivityChange[] {
  const b = isRecord(before) ? before : {};
  const a = isRecord(after) ? after : {};
  if (!isRecord(before) && !isRecord(after)) return [];
  const fields = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  const rows: ActivityChange[] = [];
  for (const field of fields) {
    const beforeStr = formatDisplay(
      Object.prototype.hasOwnProperty.call(b, field)
        ? (b as Record<string, unknown>)[field]
        : undefined,
    );
    const afterStr = formatDisplay(
      Object.prototype.hasOwnProperty.call(a, field)
        ? (a as Record<string, unknown>)[field]
        : undefined,
    );
    if (beforeStr !== afterStr) rows.push({ field, before: beforeStr, after: afterStr });
  }
  return rows;
}

interface AuditRow {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  resourceLabel: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
}

export function toActivityEntry(row: AuditRow): ActivityEntry {
  const feedKey = mapStoredAction(row.action, row.before, row.after);
  const def = FEED_BY_KEY.get(feedKey);
  const actorEmail = row.actorEmail ?? (row.actorId ? 'unknown' : 'system');
  return {
    id: row.id,
    timestamp: row.createdAt,
    action: feedKey,
    actionLabel: def?.label ?? feedKey,
    category: def?.category ?? 'Other',
    actor: { id: row.actorId ?? '', email: actorEmail, name: row.actorName ?? actorEmail },
    resource: {
      type: row.resourceType,
      id: row.resourceId ?? '',
      label: row.resourceLabel ?? row.resourceId ?? '—',
    },
    ip: row.ipAddress ?? '',
    userAgent: row.userAgent,
    changes: deriveChanges(row.before, row.after),
    requestId: row.requestId ?? '',
  };
}

export interface ActivityListQuery {
  page: number;
  limit: number;
  actions: string[];
  q?: string | undefined;
  actor?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort: 'newest' | 'oldest';
}

export interface ActivityFilterQuery {
  q?: string | undefined;
  actor?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

function dayBounds(
  from: string | undefined,
  to: string | undefined,
): { gte: Date; lte: Date } | undefined {
  if (!from && !to) return undefined;
  const gte = from ? new Date(`${from}T00:00:00.000Z`) : new Date(0);
  const lte = to ? new Date(`${to}T23:59:59.999Z`) : new Date(8640000000000000);
  if (gte.getTime() > lte.getTime()) throw badRequest('from must not be after to');
  return { gte, lte };
}

/** Stored actions whose key or feed label matches the free-text query (for `q` filtering). */
function storedActionsMatchingText(q: string): string[] {
  const needle = q.toLowerCase();
  const storedKeys = new Set([...Object.keys(STORED_TO_FEED), ...FEED_ACTIONS.map((d) => d.key)]);
  return [...storedKeys].filter((stored) => {
    const feedKey = STORED_TO_FEED[stored] ?? stored;
    const label = FEED_BY_KEY.get(feedKey)?.label ?? feedKey;
    return stored.toLowerCase().includes(needle) || label.toLowerCase().includes(needle);
  });
}

function baseWhere(query: ActivityFilterQuery): PrismaTypes.AdminAuditLogWhereInput {
  const and: PrismaTypes.AdminAuditLogWhereInput[] = [];
  if (query.actor) {
    and.push({ OR: [{ actorEmail: query.actor }, { actorId: query.actor }] });
  }
  const bounds = dayBounds(query.from, query.to);
  if (bounds) and.push({ createdAt: bounds });
  if (query.q) {
    const matched = storedActionsMatchingText(query.q);
    and.push({
      OR: [
        { actorEmail: { contains: query.q, mode: 'insensitive' } },
        { actorName: { contains: query.q, mode: 'insensitive' } },
        { resourceLabel: { contains: query.q, mode: 'insensitive' } },
        { resourceId: { contains: query.q, mode: 'insensitive' } },
        { ipAddress: { contains: query.q, mode: 'insensitive' } },
        ...(matched.length > 0 ? [{ action: { in: matched } }] : []),
      ],
    });
  }
  return and.length > 0 ? { AND: and } : {};
}

export async function listActivity(
  query: ActivityListQuery,
): Promise<{ data: ActivityEntry[]; total: number }> {
  const prisma = getPrisma();
  const stored = [...new Set(query.actions.flatMap(specKeyToStored))];
  const where: PrismaTypes.AdminAuditLogWhereInput = {
    AND: [baseWhere(query), stored.length > 0 ? { action: { in: stored } } : {}],
  };
  const dir = query.sort === 'oldest' ? 'asc' : 'desc';
  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      orderBy: [{ createdAt: dir }, { id: dir }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.adminAuditLog.count({ where }),
  ]);
  return { data: rows.map(toActivityEntry), total };
}

/**
 * Filter dropdown options: distinct stored actions (+ counts) honoring every
 * active filter EXCEPT the action itself. Pre-rename 'role.update' rows
 * count under Role updated (payload split is display-only).
 */
export async function listActionOptions(query: ActivityFilterQuery): Promise<ActionOption[]> {
  const prisma = getPrisma();
  const groups = await prisma.adminAuditLog.groupBy({
    by: ['action'],
    where: baseWhere(query),
    _count: { action: true },
  });
  const counts = new Map<string, number>();
  for (const g of groups) {
    const feedKey = STORED_TO_FEED[g.action] ?? g.action;
    counts.set(feedKey, (counts.get(feedKey) ?? 0) + g._count.action);
  }
  return [...counts.entries()]
    .map(([action, count]) => {
      const def = FEED_BY_KEY.get(action);
      return { action, label: def?.label ?? action, category: def?.category ?? 'Other', count };
    })
    .sort((a, b) =>
      a.category < b.category ? -1 : a.category > b.category ? 1 : a.label < b.label ? -1 : 1,
    );
}

export async function getActivityEntry(id: string): Promise<ActivityEntry> {
  const prisma = getPrisma();
  const row = await prisma.adminAuditLog.findUnique({ where: { id } });
  if (!row) throw notFound('Activity entry not found');
  return toActivityEntry(row);
}
