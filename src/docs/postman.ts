/**
 * Single-file → Postman pipeline.
 *
 * `src/docs/openapi.ts` is the ONLY hand-edited contract. This module
 * derives a Postman Collection v2.1 (+ local environment) from it, so
 * editing the spec automatically updates Postman — via the live
 * `GET /api/docs/postman` endpoint and via `npm run postman:export`,
 * which commits a snapshot under `postman/`.
 *
 * No new dependencies: the spec is small and hand-written, so a purpose-
 * built converter beats openapi-to-postmanv2 (version churn, bloat).
 */

interface SpecProperty {
  readonly type?: string;
  readonly format?: string;
  readonly example?: unknown;
  readonly default?: unknown;
  readonly enum?: readonly string[];
  readonly items?: SpecProperty;
  readonly properties?: Record<string, SpecProperty>;
  readonly description?: string;
  readonly nullable?: boolean;
  readonly $ref?: string;
}

interface SpecParameter {
  readonly name: string;
  readonly in: string;
  readonly required?: boolean;
  readonly schema?: SpecProperty;
}

interface SpecOperation {
  readonly tags?: readonly string[];
  readonly summary?: string;
  readonly security?: readonly unknown[];
  readonly parameters?: readonly SpecParameter[];
  readonly requestBody?: {
    readonly required?: boolean;
    readonly content?: Record<string, { readonly schema?: SpecProperty }>;
  };
}

export interface OpenApiDocument {
  readonly openapi: string;
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description?: string;
  };
  readonly servers?: readonly { readonly url: string }[];
  readonly tags?: readonly { readonly name: string; readonly description?: string }[];
  readonly components?: { readonly schemas?: Record<string, SpecProperty> };
  readonly paths: Record<string, Record<string, SpecOperation>>;
}

export interface PostmanCollection {
  readonly info: {
    readonly name: string;
    readonly description: string;
    readonly schema: string;
  };
  readonly auth: unknown;
  readonly variable: { key: string; value: string }[];
  readonly item: PostmanFolder[];
}

export interface PostmanFolder {
  readonly name: string;
  readonly description?: string;
  readonly item: PostmanItem[];
}

export interface PostmanItem {
  readonly name: string;
  readonly request: {
    readonly method: string;
    readonly header: { key: string; value: string; type: string }[];
    readonly url: {
      readonly raw: string;
      readonly host: string[];
      readonly path: string[];
      readonly query?: { key: string; value: string; disabled?: boolean }[];
      readonly variable?: { key: string; value: string }[];
    };
    readonly body?: {
      readonly mode: string;
      readonly raw: string;
      readonly options: { readonly raw: { readonly language: string } };
    };
    readonly description?: string;
  };
  readonly event?: { listen: string; script: { type: string; exec: string[] } }[];
}

export interface PostmanEnvironment {
  readonly name: string;
  readonly values: { key: string; value: string; enabled: boolean }[];
  readonly _postman_variable_scope: string;
}

const COLLECTION_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
const LOCAL_BASE_URL = 'http://localhost:4000/api/v1';

/** Extra query placeholders for list endpoints the spec leaves undeclared. */
const EXTRA_QUERY: Record<string, { key: string; value: string; disabled?: boolean }[]> = {
  'get /admin/admins': [
    { key: 'page', value: '1' },
    { key: 'limit', value: '20' },
  ],
  'get /admin/audit-log': [
    { key: 'page', value: '1' },
    { key: 'limit', value: '20' },
    { key: 'action', value: 'admin.suspend', disabled: true },
  ],
};

/** Placeholder values for path params (:id → <admin-id>, …). */
const PATH_PLACEHOLDERS: Record<string, string> = {
  id: '<admin-id>',
  key: '<role-key>',
};

const STATUS_2XX_TEST = [
  "pm.test('Status is 2xx', function () {",
  '    pm.response.to.be.success;',
  '});',
];

/** Auth-chaining scripts keyed by `method path` — variable passing between calls. */
const CHAIN_SCRIPTS: Record<string, string[]> = {
  'post /admin/auth/login': [
    "pm.test('Login returns a pending token', function () {",
    '    pm.response.to.have.status(200);',
    '    var json = pm.response.json();',
    "    pm.expect(json.data.pendingToken).to.be.a('string');",
    "    pm.collectionVariables.set('pendingToken', json.data.pendingToken);",
    '});',
  ],
  'post /admin/auth/2fa/enroll': [
    "pm.test('Enrollment returns QR + recovery codes', function () {",
    '    pm.response.to.have.status(200);',
    '    var json = pm.response.json();',
    '    pm.expect(json.data.recoveryCodes).to.be.an("array");',
    '});',
  ],
  'post /admin/auth/2fa/verify': [
    "pm.test('Verify issues a session', function () {",
    '    pm.response.to.have.status(200);',
    '    var json = pm.response.json();',
    "    pm.expect(json.data.accessToken).to.be.a('string');",
    "    pm.collectionVariables.set('accessToken', json.data.accessToken);",
    '});',
  ],
  'post /admin/auth/refresh': [
    "pm.test('Refresh rotates the session', function () {",
    '    pm.response.to.have.status(200);',
    "    pm.collectionVariables.set('accessToken', pm.response.json().data.accessToken);",
    '});',
  ],
  'post /admin/auth/logout': [...STATUS_2XX_TEST, "pm.collectionVariables.set('accessToken', '');"],
  'post /admin/auth/logout-all': [
    ...STATUS_2XX_TEST,
    "pm.collectionVariables.set('accessToken', '');",
  ],
};

function resolveRef(ref: string, doc: OpenApiDocument): SpecProperty {
  const match = /^#\/components\/schemas\/([^/]+)$/.exec(ref);
  const schema = match?.[1] ? doc.components?.schemas?.[match[1]] : undefined;
  if (!schema) throw new Error(`Unresolvable schema ref in Postman export: ${ref}`);
  return schema;
}

function exampleValue(prop: SpecProperty, doc: OpenApiDocument): unknown {
  if (prop.$ref) return exampleValue(resolveRef(prop.$ref, doc), doc);
  if (prop.example !== undefined) return prop.example;
  if (prop.default !== undefined) return prop.default;
  if (prop.enum?.length) return prop.enum[0];
  switch (prop.type) {
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return prop.items ? [exampleValue(prop.items, doc)] : [];
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(prop.properties ?? {})) out[k] = exampleValue(v, doc);
      return out;
    }
    default:
      return '';
  }
}

function exampleBody(op: SpecOperation, doc: OpenApiDocument): string | undefined {
  const schema = op.requestBody?.content?.['application/json']?.schema;
  if (!schema) return undefined;
  return JSON.stringify(exampleValue(schema, doc), null, 2);
}

function toItem(
  method: string,
  path: string,
  op: SpecOperation,
  doc: OpenApiDocument,
): PostmanItem {
  const postmanPath = path.replaceAll(/\{([^}]+)\}/g, ':$1');
  const raw = `{{baseUrl}}${postmanPath}`;
  const variables = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
    key: m[1] as string,
    value: PATH_PLACEHOLDERS[m[1] as string] ?? `<${m[1]}>`,
  }));

  const query = (op.parameters ?? [])
    .filter((p) => p.in === 'query')
    .map((p) => ({ key: p.name, value: String(p.schema?.default ?? p.schema?.example ?? '') }));
  for (const extra of EXTRA_QUERY[`${method} ${path}`] ?? []) {
    if (!query.some((q) => q.key === extra.key)) query.push({ ...extra });
  }

  const body = exampleBody(op, doc);
  return {
    name: op.summary ?? `${method.toUpperCase()} ${path}`,
    request: {
      method: method.toUpperCase(),
      header: [{ key: 'Content-Type', value: 'application/json', type: 'text' }],
      url: {
        raw,
        host: ['{{baseUrl}}'],
        path: postmanPath.split('/').filter(Boolean),
        ...(query.length ? { query } : {}),
        ...(variables.length ? { variable: variables } : {}),
      },
      ...(body
        ? {
            body: {
              mode: 'raw',
              raw: body,
              options: { raw: { language: 'json' } },
            },
          }
        : {}),
      ...(op.summary ? { description: op.summary } : {}),
    },
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: CHAIN_SCRIPTS[`${method} ${path}`] ?? STATUS_2XX_TEST,
        },
      },
    ],
  };
}

/** Derive the full Postman collection from the OpenAPI spec (single source of truth). */
export function toPostmanCollection(doc: OpenApiDocument): PostmanCollection {
  const folders = new Map<string, PostmanItem[]>();
  const tagOrder: string[] = [];
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const tag = op.tags?.[0] ?? 'misc';
      if (!folders.has(tag)) {
        folders.set(tag, []);
        tagOrder.push(tag);
      }
      folders.get(tag)?.push(toItem(method, path, op, doc));
    }
  }
  const tagDescriptions = new Map((doc.tags ?? []).map((t) => [t.name, t.description]));
  return {
    info: {
      name: `${doc.info.title} — Postman`,
      description: `${doc.info.description ?? ''}\n\nGenerated from openapi.ts — do not edit by hand. Re-export via npm run postman:export or re-import GET /api/docs/postman.`,
      schema: COLLECTION_SCHEMA,
    },
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
    },
    variable: [
      { key: 'baseUrl', value: LOCAL_BASE_URL },
      { key: 'accessToken', value: '' },
      { key: 'pendingToken', value: '' },
    ],
    item: tagOrder.map((tag) => ({
      name: tag,
      ...(tagDescriptions.get(tag) ? { description: tagDescriptions.get(tag) as string } : {}),
      item: folders.get(tag) ?? [],
    })),
  };
}

/** Local environment matching the collection variables (import alongside it). */
export function toLocalEnvironment(): PostmanEnvironment {
  return {
    name: 'ecomm-local',
    values: [
      { key: 'baseUrl', value: LOCAL_BASE_URL, enabled: true },
      { key: 'accessToken', value: '', enabled: true },
      { key: 'pendingToken', value: '', enabled: true },
    ],
    _postman_variable_scope: 'environment',
  };
}
