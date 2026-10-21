import { Router } from 'express';
import {
  createTaxClassHandler,
  createTaxRateHandler,
  deleteTaxClassHandler,
  deleteTaxRateHandler,
  getTaxClassHandler,
  listTaxClassesHandler,
  quotePreviewHandler,
  setTaxClassStatusHandler,
  updateTaxClassHandler,
  updateTaxRateHandler,
} from './tax-classes.controller.js';

/**
 * Tax classes (admin panel — Administration group, Module 5). Region rate
 * rows nest under the class; the static `/tax/quote` preview registers
 * before the nested class routes so param patterns never swallow it.
 */
export const taxClassesRouter: Router = Router();

taxClassesRouter.post('/tax/quote', ...quotePreviewHandler);

taxClassesRouter.get('/tax-classes', ...listTaxClassesHandler);
taxClassesRouter.post('/tax-classes', ...createTaxClassHandler);
taxClassesRouter.get('/tax-classes/:id', ...getTaxClassHandler);
taxClassesRouter.patch('/tax-classes/:id', ...updateTaxClassHandler);
taxClassesRouter.patch('/tax-classes/:id/status', ...setTaxClassStatusHandler);
taxClassesRouter.delete('/tax-classes/:id', ...deleteTaxClassHandler);

taxClassesRouter.post('/tax-classes/:id/rates', ...createTaxRateHandler);
taxClassesRouter.patch('/tax-classes/:id/rates/:rateId', ...updateTaxRateHandler);
taxClassesRouter.delete('/tax-classes/:id/rates/:rateId', ...deleteTaxRateHandler);
