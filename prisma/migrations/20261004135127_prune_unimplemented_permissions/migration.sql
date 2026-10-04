-- Prune permission catalog rows for modules that are not implemented yet
-- (users / products / orders). Role grants cascade automatically via the
-- admin_role_permissions.permissionId FK (onDelete: Cascade). Future modules
-- re-add their keys through the static catalog + seed, never from the panel.
DELETE FROM "permissions"
WHERE "key" IN (
  'users.view', 'users.view_details', 'users.add', 'users.update',
  'users.delete', 'users.ban', 'users.unban', 'users.export',
  'products.view', 'products.add', 'products.update', 'products.delete',
  'products.publish', 'products.archive',
  'orders.view', 'orders.update_status', 'orders.cancel', 'orders.refund',
  'orders.export'
);
