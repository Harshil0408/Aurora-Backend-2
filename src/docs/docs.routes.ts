import { Router, type Request, type Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './openapi.js';
import { asyncHandler } from '../shared/utils/asyncHandler.js';

export const docsRouter: Router = Router();

docsRouter.get(
  '/json',
  asyncHandler(async (_req: Request, res: Response): Promise<void> => {
    res.json(openApiSpec);
  }),
);

docsRouter.use('/', swaggerUi.serve, swaggerUi.setup(openApiSpec as object));
