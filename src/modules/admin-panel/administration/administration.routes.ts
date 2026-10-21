import { Router } from 'express';
import { adminsRouter } from './admins/admins.routes.js';
import { attributesRouter } from './attributes/attributes.routes.js';
import { attributeSetsRouter } from './attribute-sets/attribute-sets.routes.js';
import { catalogAttributesRouter } from './catalog-attributes/catalog-attributes.routes.js';
import { brandsRouter } from './brands/brands.routes.js';
import { categoriesRouter } from './categories/categories.routes.js';
import { commerceSettingsRouter } from './commerce-settings/commerce-settings.routes.js';
import { hsnCodesRouter } from './hsn-codes/hsn-codes.routes.js';
import { taxClassesRouter } from './tax-classes/tax-classes.routes.js';
import { unitsRouter } from './units/units.routes.js';
import { uploadsRouter } from './uploads/uploads.routes.js';
import { rolesPermissionsRouter } from './roles-permissions/roles-permissions.routes.js';
import { activityLogRouter } from './activity-log/activity-log.routes.js';

/**
 * Administration group of the admin panel (mirrors the frontend sidebar group):
 * Admins, Roles & Permissions, Activity Log, Attributes (lookup dictionary),
 * Catalog Attributes, Attribute Sets, Categories, Brands, Tax/HSN/Units,
 * Commerce Settings.
 * The Sessions screen router mounts separately under /api/v1/admin/auth
 * (same URLs as before) — see sessions/sessions.routes.ts.
 */
export const administrationRouter: Router = Router();

administrationRouter.use(adminsRouter);
administrationRouter.use(rolesPermissionsRouter);
administrationRouter.use(activityLogRouter);
administrationRouter.use(attributesRouter);
administrationRouter.use(catalogAttributesRouter);
administrationRouter.use(attributeSetsRouter);
administrationRouter.use(categoriesRouter);
administrationRouter.use(brandsRouter);
administrationRouter.use(taxClassesRouter);
administrationRouter.use(hsnCodesRouter);
administrationRouter.use(unitsRouter);
administrationRouter.use(commerceSettingsRouter);
administrationRouter.use(uploadsRouter);
