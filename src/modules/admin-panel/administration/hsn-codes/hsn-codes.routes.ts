import { Router } from 'express';
import {
  createHsnCodeHandler,
  deleteHsnCodeHandler,
  listHsnCodesHandler,
  updateHsnCodeHandler,
} from './hsn-codes.controller.js';

/** HSN/SAC master (admin panel — Administration group, Module 5). */
export const hsnCodesRouter: Router = Router();

hsnCodesRouter.get('/hsn-codes', ...listHsnCodesHandler);
hsnCodesRouter.post('/hsn-codes', ...createHsnCodeHandler);
hsnCodesRouter.patch('/hsn-codes/:id', ...updateHsnCodeHandler);
hsnCodesRouter.delete('/hsn-codes/:id', ...deleteHsnCodeHandler);
