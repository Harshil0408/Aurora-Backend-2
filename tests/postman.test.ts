import { describe, expect, it } from 'vitest';
import { openApiSpec } from '../src/docs/openapi.js';
import { toLocalEnvironment, toPostmanCollection } from '../src/docs/postman.js';

/**
 * Guards the single-file → Postman pipeline: every spec path+method must
 * appear in the collection, bodies must carry examples, and the auth chain
 * (login → pendingToken → verify → accessToken) must stay wired.
 */
describe('postman export', () => {
  it('covers every spec path and method', () => {
    const collection = toPostmanCollection(openApiSpec);
    const got = new Set<string>();
    for (const folder of collection.item) {
      for (const item of folder.item) {
        const url = item.request.url.raw.replace('{{baseUrl}}', '');
        const openapiPath = url.replaceAll(/:([^/]+)/g, '{$1}');
        got.add(`${item.request.method.toLowerCase()} ${openapiPath}`);
      }
    }
    for (const [path, methods] of Object.entries(openApiSpec.paths)) {
      for (const method of Object.keys(methods)) {
        expect(got.has(`${method} ${path}`)).toBe(true);
      }
    }
  });

  it('groups requests into auth/admin/seller folders with bearer inheritance', () => {
    const collection = toPostmanCollection(openApiSpec);
    expect(collection.item.map((f) => f.name).sort()).toEqual(['admin', 'attributes', 'auth', 'seller']);
    expect(collection.auth).toMatchObject({ type: 'bearer' });
    expect(collection.variable.map((v) => v.key).sort()).toEqual([
      'accessToken',
      'baseUrl',
      'pendingToken',
    ]);
  });

  it('embeds example bodies for write endpoints', () => {
    const collection = toPostmanCollection(openApiSpec);
    const admin = collection.item.find((f) => f.name === 'admin');
    const createAdmin = admin?.item.find((i) => i.name.includes('Create admin'));
    const body = createAdmin?.request.body?.raw ?? '';
    expect(JSON.parse(body)).toMatchObject({ email: expect.any(String), roleKeys: ['support'] });
  });

  it('chains auth variables between login, verify, and refresh', () => {
    const collection = toPostmanCollection(openApiSpec);
    const auth = collection.item.find((f) => f.name === 'auth');
    const scriptOf = (namePart: string): string =>
      (auth?.item.find((i) => i.name.includes(namePart))?.event?.[0]?.script.exec ?? []).join('\n');
    expect(scriptOf('Password login')).toContain("set('pendingToken'");
    expect(scriptOf('verify TOTP')).toContain("set('accessToken'");
    expect(scriptOf('Rotate refresh')).toContain("set('accessToken'");
  });

  it('emits a local environment matching the collection variables', () => {
    const environment = toLocalEnvironment();
    expect(environment.values.map((v) => v.key).sort()).toEqual([
      'accessToken',
      'baseUrl',
      'pendingToken',
    ]);
    expect(environment.values.find((v) => v.key === 'baseUrl')?.value).toContain('/api/v1');
  });
});
