import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getEnv } from '../../../../config/env.js';
import {
  changePasswordHandler,
  confirm2fa,
  confirmEmailOtpHandler,
  confirmTotpAuthed,
  disable2fa,
  disableEmailOtpHandler,
  enroll2fa,
  enrollTotpAuthed,
  forgotPassword,
  getMe,
  login,
  logout,
  logoutAll,
  refresh,
  requestEmailOtpHandler,
  resendEmailOtpHandler,
  resetPasswordHandler,
  verify2fa,
} from '../controllers/auth.controller.js';

export const authRouter: Router = Router();

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
authRouter.get('/me', ...getMe);
authRouter.post('/2fa/enroll', loginLimiter(), enroll2fa);
authRouter.post('/2fa/confirm', loginLimiter(), confirm2fa);
authRouter.post('/2fa/verify', loginLimiter(), verify2fa);
authRouter.post('/2fa/totp/enroll', ...enrollTotpAuthed);
authRouter.post('/2fa/totp/confirm', ...confirmTotpAuthed);
authRouter.post('/2fa/email/request', loginLimiter(), ...requestEmailOtpHandler);
authRouter.post('/2fa/email/confirm', loginLimiter(), ...confirmEmailOtpHandler);
authRouter.post('/2fa/email/disable', ...disableEmailOtpHandler);
authRouter.post('/2fa/email/resend', loginLimiter(), resendEmailOtpHandler);
authRouter.post('/refresh', refresh);
authRouter.post('/logout', ...logout);
authRouter.post('/logout-all', ...logoutAll);
authRouter.post('/forgot-password', loginLimiter(), forgotPassword);
authRouter.post('/reset-password', loginLimiter(), resetPasswordHandler);
authRouter.post('/change-password', ...changePasswordHandler);
authRouter.post('/2fa/disable', ...disable2fa);
