import { Router, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './openapi.js';
import { toPostmanCollection } from './postman.js';
import { asyncHandler } from '../shared/utils/asyncHandler.js';

export const docsRouter: Router = Router();

docsRouter.get(
  '/json',
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.json(openApiSpec);
  }),
);

/**
 * Live Postman collection (Collection v2.1), derived from openapi.ts on
 * every call — always in sync. Import in Postman via URL; a committed
 * snapshot lives under postman/ (regenerate: npm run postman:export).
 */
docsRouter.get(
  '/postman',
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.json(toPostmanCollection(openApiSpec));
  }),
);

docsRouter.use('/', swaggerUi.serve, swaggerUi.setup(openApiSpec as object));
