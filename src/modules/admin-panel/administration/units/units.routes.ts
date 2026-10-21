import { Router } from 'express';
import {
  createUnitHandler,
  deleteUnitHandler,
  listUnitsHandler,
  updateUnitHandler,
} from './units.controller.js';

/** Units of measure (admin panel — Administration group, Module 5). */
export const unitsRouter: Router = Router();

unitsRouter.get('/units', ...listUnitsHandler);
unitsRouter.post('/units', ...createUnitHandler);
unitsRouter.patch('/units/:id', ...updateUnitHandler);
unitsRouter.delete('/units/:id', ...deleteUnitHandler);
