// Snapshot the live Postman collection + local environment to postman/.
// Run with tsx (devDependency) so the TS sources are read without a build:
//   npm run postman:export
// Re-run after every openapi.ts change and commit the result.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApiSpec } from '../src/docs/openapi.js';
import { toLocalEnvironment, toPostmanCollection } from '../src/docs/postman.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'postman');
await mkdir(outDir, { recursive: true });

const collectionPath = join(outDir, 'ecomm-admin-api.postman_collection.json');
const environmentPath = join(outDir, 'ecomm-local.postman_environment.json');

await writeFile(collectionPath, `${JSON.stringify(toPostmanCollection(openApiSpec), null, 2)}\n`);
await writeFile(environmentPath, `${JSON.stringify(toLocalEnvironment(), null, 2)}\n`);

const requests = toPostmanCollection(openApiSpec).item.reduce((n, f) => n + f.item.length, 0);
console.log(`Wrote ${requests} requests -> ${collectionPath}`);
console.log(`Wrote local environment -> ${environmentPath}`);
