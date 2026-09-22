/**
 * OpenAPI 3.0 for the admin auth module. Hand-written (single source of
 * truth for contracts); served at /api/docs (Swagger UI) and /api/docs.json.
 */
export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'E-Comm Admin Auth API',
    version: '1.0.0',
    description:
      'Password login (step 1) → TOTP 2FA (step 2, mandatory) → short-lived JWT + rotating refresh sessions. All failures use generic messages.',
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    { name: 'auth', description: 'Login, 2FA, sessions, passwords (refresh cookie: admin_rt)' },
    { name: 'admin', description: 'Admin + role management (permission-gated)' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'UNAUTHORIZED' },
              message: { type: 'string', example: 'Invalid email or password' },
              requestId: { type: 'string' },
            },
          },
        },
      },
      LoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'admin@local.test' },
          password: { type: 'string', example: 'Sup3r-Bootstr4p-9xQ2' },
        },
      },
      LoginResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            required: ['requires2fa', 'pendingToken', 'expiresInSeconds'],
            properties: {
              requires2fa: { type: 'boolean', example: true },
              pendingToken: {
                type: 'string',
                description: '2FA-pending JWT, 5 min, grants nothing',
              },
              expiresInSeconds: { type: 'integer', example: 300 },
            },
          },
        },
      },
      PendingToken: {
        type: 'object',
        required: ['pendingToken'],
        properties: { pendingToken: { type: 'string' } },
      },
      TotpVerify: {
        type: 'object',
        required: ['pendingToken', 'code'],
        properties: {
          pendingToken: { type: 'string' },
          code: { type: 'string', example: '123456', description: '6-digit TOTP or recovery code' },
        },
      },
      SessionResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            required: ['accessToken', 'expiresInSeconds'],
            properties: {
              accessToken: { type: 'string' },
              expiresInSeconds: { type: 'integer', example: 300 },
              method: { type: 'string', enum: ['totp', 'recovery'] },
            },
          },
        },
      },
      EnrollmentResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            required: ['otpauthUrl', 'qrDataUrl', 'recoveryCodes'],
            properties: {
              otpauthUrl: { type: 'string' },
              qrDataUrl: { type: 'string', description: 'PNG data URL for the QR code' },
              recoveryCodes: {
                type: 'array',
                items: { type: 'string' },
                description: 'Shown ONCE — store securely',
              },
            },
          },
        },
      },
    },
  },
  paths: {
    '/admin/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Step 1: password login → 2FA-pending token (never a session)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Password OK — complete 2FA next',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/LoginResponse' } },
            },
          },
          '400': { description: 'Validation failed' },
          '401': {
            description: 'Generic: bad credentials, locked, suspended, or disabled',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          '429': { description: 'Rate limited (20/15min/IP + 5-fail account lockout)' },
        },
      },
    },
    '/admin/auth/2fa/enroll': {
      post: {
        tags: ['auth'],
        summary: 'Begin 2FA enrollment (pending token). Returns QR + one-time recovery codes',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PendingToken' } },
          },
        },
        responses: {
          '200': {
            description: 'Enrollment started (inactive until confirmed)',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/EnrollmentResponse' } },
            },
          },
          '401': { description: 'Invalid/expired pending token' },
        },
      },
    },
    '/admin/auth/2fa/confirm': {
      post: {
        tags: ['auth'],
        summary: 'Activate 2FA by proving the authenticator code works',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TotpVerify' } } },
        },
        responses: {
          '200': { description: '2FA enrolled' },
          '401': { description: 'Invalid code/token' },
        },
      },
    },
    '/admin/auth/2fa/verify': {
      post: {
        tags: ['auth'],
        summary: 'Step 2: verify TOTP/recovery code → access JWT + refresh cookie (admin_rt)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/TotpVerify' } } },
        },
        responses: {
          '200': {
            description: 'Fully authenticated',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SessionResponse' } },
            },
          },
          '401': { description: 'Invalid code/token' },
        },
      },
    },
    '/admin/auth/refresh': {
      post: {
        tags: ['auth'],
        summary: 'Rotate refresh cookie → fresh access JWT (reuse = family revoked)',
        responses: {
          '200': {
            description: 'Rotated',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/SessionResponse' } },
            },
          },
          '401': { description: 'Invalid, expired, or reused token' },
        },
      },
    },
    '/admin/auth/logout': {
      post: {
        tags: ['auth'],
        summary: 'Revoke current session',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Logged out' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/admin/auth/logout-all': {
      post: {
        tags: ['auth'],
        summary: 'Revoke ALL sessions + kill all JWTs (tokenVersion bump)',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Logged out everywhere' } },
      },
    },
    '/admin/auth/sessions': {
      get: {
        tags: ['auth'],
        summary: 'List own active sessions (authenticated, paginated)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { '200': { description: 'Session list' }, '403': { description: 'Forbidden' } },
      },
    },
    '/admin/auth/sessions/{id}': {
      delete: {
        tags: ['auth'],
        summary: 'Revoke a session (own always; others need session.revoke)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Revoked (idempotent)' } },
      },
    },
    '/admin/auth/forgot-password': {
      post: {
        tags: ['auth'],
        summary: 'Request reset (always generic 200 — no enumeration)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: { email: { type: 'string', format: 'email' } },
              },
            },
          },
        },
        responses: { '200': { description: 'If the account exists, a token was sent' } },
      },
    },
    '/admin/auth/reset-password': {
      post: {
        tags: ['auth'],
        summary: 'Single-use reset token → new password (history-checked, kills sessions)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token', 'newPassword'],
                properties: {
                  token: { type: 'string' },
                  newPassword: { type: 'string', minLength: 12 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Reset' },
          '400': { description: 'Invalid/expired/reused' },
        },
      },
    },
    '/admin/auth/change-password': {
      post: {
        tags: ['auth'],
        summary: 'Authenticated change (reauth + history check, kills sessions)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['currentPassword', 'newPassword'],
                properties: {
                  currentPassword: { type: 'string' },
                  newPassword: { type: 'string', minLength: 12 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Changed' },
          '401': { description: 'Wrong current password' },
        },
      },
    },
    '/admin/auth/2fa/disable': {
      post: {
        tags: ['auth'],
        summary: 'Disable 2FA (password + 2FA reauth, wipes secret, kills sessions)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['password', 'code'],
                properties: { password: { type: 'string' }, code: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Disabled' } },
      },
    },
    '/admin/admins': {
      get: {
        tags: ['admin'],
        summary: 'List admins (perm: admin.read, paginated)',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Admin list' }, '403': { description: 'Forbidden' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Create admin (perm: admin.create; super_admin grants need Super Admin)',
        security: [{ bearerAuth: [] }],
        responses: {
          '201': { description: 'Created' },
          '403': { description: 'Escalation blocked' },
          '409': { description: 'Email exists' },
        },
      },
    },
    '/admin/admins/{id}/status': {
      patch: {
        tags: ['admin'],
        summary: 'Suspend/disable/reactivate (perm: admin.suspend; never self or last Super Admin)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated' } },
      },
    },
    '/admin/admins/{id}/roles': {
      put: {
        tags: ['admin'],
        summary: 'Replace roles (perm: role.assign; escalation + self-lockout guarded)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated' } },
      },
    },
    '/admin/roles': {
      get: {
        tags: ['admin'],
        summary: 'List roles + permissions (perm: role.read)',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Role list' } },
      },
      post: {
        tags: ['admin'],
        summary: 'Create role (perm: role.create)',
        security: [{ bearerAuth: [] }],
        responses: { '201': { description: 'Created' } },
      },
    },
    '/admin/roles/{key}/permissions': {
      put: {
        tags: ['admin'],
        summary:
          'Replace role permissions (perm: role.update; super_admin role is Super-Admin-only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated' } },
      },
    },
    '/admin/audit-log': {
      get: {
        tags: ['admin'],
        summary: 'Query audit trail (perm: audit.read, paginated, ?action=)',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Audit entries' } },
      },
    },
  },
} as const;
