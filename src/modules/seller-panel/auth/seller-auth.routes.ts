import { Router } from 'express';
import {
  listSessionsHandler,
  loginHandler,
  logoutAllHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
  registerHandler,
  sellerLoginLimiter,
} from './seller-auth.controller.js';

export const sellerAuthRouter: Router = Router();

sellerAuthRouter.post('/register', sellerLoginLimiter(), registerHandler);
sellerAuthRouter.post('/login', sellerLoginLimiter(), loginHandler);
sellerAuthRouter.get('/me', ...meHandler);
sellerAuthRouter.post('/refresh', refreshHandler);
sellerAuthRouter.post('/logout', ...logoutHandler);
sellerAuthRouter.post('/logout-all', ...logoutAllHandler);
sellerAuthRouter.get('/sessions', ...listSessionsHandler);
