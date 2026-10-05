import { describe, expect, it } from 'vitest';
import {
  deriveChanges,
  FEED_ACTIONS,
  mapStoredAction,
  specKeyToStored,
} from '../src/modules/admin-panel/administration/activity-log/activity-log.service.js';

describe('activity feed mapping', () => {
  it('maps stored actions to stable feed keys', () => {
    expect(mapStoredAction('admin.create', {}, {})).toBe('admin.created');
    expect(mapStoredAction('admin.suspend', {}, {})).toBe('admin.status_changed');
    expect(mapStoredAction('role.assign', {}, {})).toBe('admin.roles_updated');
    expect(mapStoredAction('session.revoke', {}, {})).toBe('admin.sessions_revoked');
    expect(mapStoredAction('role.create', {}, {})).toBe('role.created');
    expect(mapStoredAction('role.permissions.add', {}, {})).toBe('role.permissions_granted');
    expect(mapStoredAction('permission.activate', {}, {})).toBe('permission.status_changed');
    expect(mapStoredAction('something.new', {}, {})).toBe('something.new');
  });

  it('disambiguates legacy role.update rows by payload', () => {
    expect(mapStoredAction('role.update', { name: 'A' }, { name: 'B' })).toBe('role.updated');
    expect(
      mapStoredAction('role.update', { permissions: ['a'] }, { permissions: ['a', 'b'] }),
    ).toBe('role.permissions_updated');
    expect(mapStoredAction('role.update', undefined, { permissions: [] })).toBe(
      'role.permissions_updated',
    );
  });

  it('translates feed keys back to stored actions for filtering', () => {
    expect(specKeyToStored('role.permissions_updated')).toEqual([
      'role.permissions_updated',
      'role.update',
    ]);
    expect(specKeyToStored('role.updated')).toEqual(['role.update']);
    expect(specKeyToStored('admin.created')).toEqual(['admin.create', 'admin.bootstrap']);
    expect(specKeyToStored('nope.unknown')).toEqual(['nope.unknown']);
  });

  it('exposes a fixed feed catalog', () => {
    const keys = FEED_ACTIONS.map((d) => d.key);
    expect(keys).toContain('role.permissions_updated');
    expect(keys).toContain('admin.sessions_revoked');
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('deriveChanges', () => {
  it('diffs before/after into display rows', () => {
    expect(
      deriveChanges(
        { roles: ['support'], status: 'ACTIVE' },
        { roles: ['support', 'sub'], status: 'ACTIVE' },
      ),
    ).toEqual([{ field: 'roles', before: 'support', after: 'support, sub' }]);
  });

  it('marks missing sides with an em dash', () => {
    expect(deriveChanges(undefined, { permissions: ['a'] })).toEqual([
      { field: 'permissions', before: '—', after: 'a' },
    ]);
    expect(deriveChanges({ key: 'x', name: 'X' }, undefined)).toEqual([
      { field: 'key', before: 'x', after: '—' },
      { field: 'name', before: 'X', after: '—' },
    ]);
  });

  it('renders empty arrays as a dash and truncates long values', () => {
    expect(deriveChanges({ permissions: ['a'] }, { permissions: [] })).toEqual([
      { field: 'permissions', before: 'a', after: '—' },
    ]);
    const long = 'x'.repeat(500);
    const [row] = deriveChanges({ note: long }, {});
    expect(row?.after).toBe('—');
    expect(row?.before.length).toBeLessThanOrEqual(120);
  });

  it('omits fields that did not change', () => {
    expect(deriveChanges({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([
      { field: 'b', before: '2', after: '3' },
    ]);
    expect(deriveChanges({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('returns no rows when neither side is an object', () => {
    expect(deriveChanges(null, null)).toEqual([]);
    expect(deriveChanges('a', 'b')).toEqual([]);
  });
});
