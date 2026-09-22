import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getEnv } from '../../../config/env.js';
import {
  changePasswordHandler,
  confirm2fa,
  disable2fa,
  enroll2fa,
  forgotPassword,
  listSessions,
  login,
  logout,
  logoutAll,
  refresh,
  resetPasswordHandler,
  revokeOneSession,
  verify2fa,
} from '../controllers/auth.controller.js';

export const authRouter: Router = Router();

/**
 * Login-specific limiter (stricter than the global one): 20 attempts per
 * 15 min per IP by default. Account lockout (5 fails → 15 min) is the
 * second layer — this one protects the endpoint, that one protects the account.
 */
function loginLimiter(): ReturnType<typeof rateLimit> {
  const env = getEnv();
  return rateLimit({
    windowMs: 15 * 60_000,
    max: env.LOGIN_RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
  });
}

authRouter.post('/login', loginLimiter(), login);
authRouter.post('/2fa/enroll', loginLimiter(), enroll2fa);
authRouter.post('/2fa/confirm', loginLimiter(), confirm2fa);
authRouter.post('/2fa/verify', loginLimiter(), verify2fa);
authRouter.post('/refresh', refresh);
authRouter.post('/logout', ...logout);
authRouter.post('/logout-all', ...logoutAll);
authRouter.get('/sessions', ...listSessions);
authRouter.delete('/sessions/:id', ...revokeOneSession);
authRouter.post('/forgot-password', loginLimiter(), forgotPassword);
authRouter.post('/reset-password', loginLimiter(), resetPasswordHandler);
authRouter.post('/change-password', ...changePasswordHandler);
authRouter.post('/2fa/disable', ...disable2fa);
