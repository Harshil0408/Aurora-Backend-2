import { Router } from 'express';
import {
  acceptInvitationHandler,
  createRoleHandler,
  deleteRoleHandler,
  inviteMemberHandler,
  listInvitationsHandler,
  listMembersHandler,
  listPermissionsHandler,
  listRolesHandler,
  removeMemberHandler,
  revokeInvitationHandler,
  setRolePermissionsHandler,
  updateMemberRoleHandler,
  updateRoleHandler,
} from './team.controller.js';

export const teamAreaRouter: Router = Router();

// Invitation acceptance is user-scoped (no :storeId yet — the token carries it).
teamAreaRouter.post('/invitations/accept', ...acceptInvitationHandler);

// Everything below is store-scoped (`:storeId` authorized by requireStoreAccess).
teamAreaRouter.get('/:storeId/roles', ...listRolesHandler);
teamAreaRouter.post('/:storeId/roles', ...createRoleHandler);
teamAreaRouter.patch('/:storeId/roles/:roleKey', ...updateRoleHandler);
teamAreaRouter.put('/:storeId/roles/:roleKey/permissions', ...setRolePermissionsHandler);
teamAreaRouter.delete('/:storeId/roles/:roleKey', ...deleteRoleHandler);
teamAreaRouter.get('/:storeId/permissions', ...listPermissionsHandler);
teamAreaRouter.get('/:storeId/members', ...listMembersHandler);
teamAreaRouter.patch('/:storeId/members/:userId/role', ...updateMemberRoleHandler);
teamAreaRouter.delete('/:storeId/members/:userId', ...removeMemberHandler);
teamAreaRouter.post('/:storeId/invitations', ...inviteMemberHandler);
teamAreaRouter.get('/:storeId/invitations', ...listInvitationsHandler);
teamAreaRouter.post('/:storeId/invitations/:invitationId/revoke', ...revokeInvitationHandler);
