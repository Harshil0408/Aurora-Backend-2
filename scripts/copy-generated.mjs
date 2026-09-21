// Cross-platform: copy Prisma's generated client (js/wasm) into dist/
// because tsc only emits compiled .ts and ignores generated .js assets.
import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(join(root, 'dist', 'generated'), { recursive: true });
await cp(join(root, 'src', 'generated'), join(root, 'dist', 'generated'), {
  recursive: true,
});
console.log('Copied src/generated -> dist/generated');
