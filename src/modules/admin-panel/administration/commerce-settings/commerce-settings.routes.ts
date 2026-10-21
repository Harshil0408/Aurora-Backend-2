import { Router } from 'express';
import { getSettingsHandler, updateSettingsHandler } from './commerce-settings.controller.js';

/** Commerce settings singleton (admin panel — Administration group, Module 5). */
export const commerceSettingsRouter: Router = Router();

commerceSettingsRouter.get('/commerce-settings', ...getSettingsHandler);
commerceSettingsRouter.patch('/commerce-settings', ...updateSettingsHandler);
