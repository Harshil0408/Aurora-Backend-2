import { Router } from 'express';
import {
  completeOnboardingHandler,
  createStoreHandler,
  getStoreHandler,
  listMyStoresHandler,
  switchStoreHandler,
  updateStoreHandler,
} from './stores/stores.controller.js';

export const storesAreaRouter: Router = Router();

// Workspace-level endpoints (authenticated user, no store context yet).
storesAreaRouter.post('/', ...createStoreHandler);
storesAreaRouter.get('/', ...listMyStoresHandler);
storesAreaRouter.post('/switch', ...switchStoreHandler);

// Store-scoped endpoints (`:storeId` resolved + authorized by requireStoreAccess).
storesAreaRouter.get('/:storeId', ...getStoreHandler);
storesAreaRouter.patch('/:storeId', ...updateStoreHandler);
storesAreaRouter.post('/:storeId/complete-onboarding', ...completeOnboardingHandler);
