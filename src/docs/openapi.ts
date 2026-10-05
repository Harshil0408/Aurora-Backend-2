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
      'Optional 2FA: password login returns a session directly when no 2FA method is on, else a 2FA-pending token (channel totp|email_otp) → verify → short-lived JWT + rotating refresh sessions. All failures use generic messages.',
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
            required: ['requires2fa', 'expiresInSeconds'],
            properties: {
              requires2fa: {
                type: 'boolean',
                example: true,
                description:
                  'false → direct session (accessToken present); true → pendingToken + channel',
              },
              channel: {
                type: 'string',
                enum: ['totp', 'email_otp'],
                description: 'Present when requires2fa is true (TOTP wins when both are on)',
              },
              pendingToken: {
                type: 'string',
                description: '2FA-pending JWT, 5 min, grants nothing (requires2fa=true only)',
              },
              accessToken: {
                type: 'string',
                description: 'Direct session JWT (requires2fa=false only; refresh cookie set too)',
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
          code: {
            type: 'string',
            example: '123456',
            description: 'TOTP, recovery code, or emailed OTP — whichever the channel requires',
          },
        },
      },
      AuthCode: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string', example: '123456' } },
      },
      DisableEmailOtp: {
        type: 'object',
        required: ['password', 'code'],
        properties: {
          password: { type: 'string', description: 'Current password (re-auth)' },
          code: { type: 'string', example: '123456', description: 'Fresh emailed code' },
        },
      },
      MeResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', example: true },
          data: {
            type: 'object',
            required: ['id', 'email', 'status', 'twoFactor', 'roles', 'permissions', 'createdAt'],
            properties: {
              id: { type: 'string' },
              email: { type: 'string', format: 'email' },
              status: { type: 'string', enum: ['PENDING', 'ACTIVE', 'SUSPENDED', 'DISABLED'] },
              twoFactor: {
                type: 'object',
                required: ['totpEnabled', 'emailOtpEnabled'],
                properties: {
                  totpEnabled: { type: 'boolean' },
                  emailOtpEnabled: { type: 'boolean' },
                },
              },
              roles: { type: 'array', items: { type: 'string' }, example: ['super_admin'] },
              permissions: { type: 'array', items: { type: 'string' } },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
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
              method: { type: 'string', enum: ['totp', 'recovery', 'email_otp'] },
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
      CreateAdminRequest: {
        type: 'object',
        required: ['email', 'roleKeys'],
        properties: {
          email: { type: 'string', format: 'email', example: 'ops@local.test' },
          name: {
            type: 'string',
            example: 'Ops Operator',
            description: 'Min 2 chars; defaults to the email local-part',
          },
          tempPassword: {
            type: 'string',
            minLength: 12,
            example: 'Temp-Password-123!',
            description:
              'UI field name (`password` still accepted). Min 12 chars + letters and numbers.',
          },
          password: {
            type: 'string',
            minLength: 12,
            description: 'Legacy alias of tempPassword — send either one.',
          },
          roleKeys: { type: 'array', items: { type: 'string' }, example: ['support'] },
        },
      },
      AdminListItem: {
        type: 'object',
        required: ['id', 'email', 'name', 'status', 'roles', 'twoFactor', 'createdAt'],
        properties: {
          id: { type: 'string' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED', 'DISABLED', 'PENDING'] },
          roles: {
            type: 'array',
            items: {
              type: 'object',
              required: ['key', 'name'],
              properties: { key: { type: 'string' }, name: { type: 'string' } },
            },
          },
          twoFactor: {
            type: 'object',
            required: ['enabled', 'methods'],
            properties: {
              enabled: { type: 'boolean' },
              methods: { type: 'array', items: { type: 'string', enum: ['totp', 'email_otp'] } },
            },
          },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
          isSelf: { type: 'boolean' },
          isLastActiveSuperAdmin: { type: 'boolean' },
        },
      },
      SetStatusRequest: {
        type: 'object',
        required: ['status', 'reason'],
        properties: {
          status: {
            type: 'string',
            enum: ['ACTIVE', 'SUSPENDED', 'DISABLED', 'Active', 'Suspended', 'Disabled'],
            description: 'UPPERCASE canonical; Capitalized display form also accepted',
          },
          reason: {
            type: 'string',
            minLength: 3,
            maxLength: 500,
            description: 'Required — persisted to the audit entry',
          },
        },
      },
      SetRolesRequest: {
        type: 'object',
        required: ['roleKeys'],
        properties: {
          roleKeys: { type: 'array', items: { type: 'string' }, example: ['sub_admin'] },
        },
      },
      CreateRoleRequest: {
        type: 'object',
        required: ['key', 'name'],
        properties: {
          key: {
            type: 'string',
            example: 'billing-analyst',
            description: 'Slug format (lowercase-hyphens). Permanent — can never be renamed.',
          },
          name: { type: 'string', example: 'Billing Analyst' },
          description: { type: 'string', example: 'Read-only billing reports' },
          permissionKeys: {
            type: 'array',
            items: { type: 'string' },
            example: ['admin.read'],
            description:
              'Optional. Omitted = role starts with every ACTIVE catalog permission (trim afterwards). Explicit array (even empty) is honored as-is.',
          },
        },
      },
      UpdateRoleRequest: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Billing Analyst' },
          description: { type: 'string', nullable: true },
        },
      },
      SetPermissionsRequest: {
        type: 'object',
        required: ['permissionKeys'],
        properties: {
          permissionKeys: { type: 'array', items: { type: 'string' }, example: ['admin.read'] },
        },
      },
      CloneRoleRequest: {
        type: 'object',
        required: ['key', 'name'],
        properties: {
          key: { type: 'string', example: 'billing-analyst' },
          name: { type: 'string', example: 'Billing Analyst (copy)' },
          description: { type: 'string' },
        },
      },
      SetRoleStatusRequest: {
        type: 'object',
        required: ['status', 'reason'],
        properties: {
          status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
          reason: { type: 'string', minLength: 3, maxLength: 500 },
        },
      },
      ActivityEntry: {
        type: 'object',
        required: [
          'id',
          'timestamp',
          'action',
          'actionLabel',
          'category',
          'actor',
          'resource',
          'ip',
          'changes',
          'requestId',
        ],
        properties: {
          id: { type: 'string', example: 'cm3x7k9q20001s8n2abcd1234' },
          timestamp: { type: 'string', format: 'date-time' },
          action: { type: 'string', example: 'role.permissions_updated' },
          actionLabel: { type: 'string', example: 'Role updated' },
          category: { type: 'string', example: 'Roles' },
          actor: {
            type: 'object',
            required: ['id', 'email', 'name'],
            properties: {
              id: { type: 'string' },
              email: { type: 'string', example: 'aisha@mercato.com' },
              name: { type: 'string', example: 'Aisha' },
            },
            description: 'Write-time snapshot — survives later renames',
          },
          resource: {
            type: 'object',
            required: ['type', 'id', 'label'],
            properties: {
              type: { type: 'string', example: 'role' },
              id: { type: 'string', example: 'billing-analyst' },
              label: { type: 'string', example: 'Billing Analyst' },
            },
            description: 'Write-time snapshot — survives later renames/deletes',
          },
          ip: { type: 'string', example: '84.121.9.40' },
          userAgent: { type: 'string', nullable: true },
          changes: {
            type: 'array',
            items: {
              type: 'object',
              required: ['field', 'before', 'after'],
              properties: {
                field: { type: 'string', example: 'permissions' },
                before: { type: 'string', example: 'admin.read' },
                after: { type: 'string', example: 'admin.read, audit.read' },
              },
            },
            description: 'Pre-formatted display strings (— when empty); may be []',
          },
          requestId: { type: 'string' },
        },
      },
      ActionOption: {
        type: 'object',
        required: ['action', 'label', 'category', 'count'],
        properties: {
          action: { type: 'string', example: 'role.permissions_updated' },
          label: { type: 'string', example: 'Role updated' },
          category: { type: 'string', example: 'Roles' },
          count: { type: 'integer', example: 12 },
        },
      },
    },
  },
  paths: {
    '/admin/auth/login': {
      post: {
        tags: ['auth'],
        summary:
          'Password login → direct session when no 2FA is on, else 2FA-pending token (+ channel)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } },
          },
        },
        responses: {
          '200': {
            description: 'Session directly (requires2fa=false) or pending token (requires2fa=true)',
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
    '/admin/auth/me': {
      get: {
        tags: ['auth'],
        summary: 'Logged-in admin profile: roles, 2FA flags, effective permissions',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Profile',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/MeResponse' } },
            },
          },
          '401': { description: 'Missing/invalid/expired access token' },
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
        summary:
          'Step 2: verify TOTP / recovery / emailed code → access JWT + refresh cookie (admin_rt)',
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
    '/admin/auth/2fa/totp/enroll': {
      post: {
        tags: ['auth'],
        summary:
          'Enable TOTP while logged in (Security page). Returns QR + one-time recovery codes',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Enrollment started (inactive until confirmed)',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/EnrollmentResponse' } },
            },
          },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/admin/auth/2fa/totp/confirm': {
      post: {
        tags: ['auth'],
        summary: 'Confirm TOTP enrollment with an authenticator code (logged in)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthCode' } } },
        },
        responses: {
          '200': { description: 'TOTP enabled — next login challenges with TOTP' },
          '401': { description: 'Invalid code' },
        },
      },
    },
    '/admin/auth/2fa/email/request': {
      post: {
        tags: ['auth'],
        summary: 'Email a 6-digit code proving mailbox ownership (enable flow, logged in)',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': { description: 'Code sent (10-min TTL, single outstanding)' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/admin/auth/2fa/email/confirm': {
      post: {
        tags: ['auth'],
        summary: 'Confirm the emailed code → email-OTP 2FA enabled (logged in)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthCode' } } },
        },
        responses: {
          '200': { description: 'Email OTP enabled — next login challenges by email' },
          '401': { description: 'Invalid or expired code' },
        },
      },
    },
    '/admin/auth/2fa/email/disable': {
      post: {
        tags: ['auth'],
        summary: 'Disable email-OTP 2FA (password + fresh emailed code, kills all sessions)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/DisableEmailOtp' } },
          },
        },
        responses: { '200': { description: 'Disabled' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/admin/auth/2fa/email/resend': {
      post: {
        tags: ['auth'],
        summary: 'Re-send the login OTP email (pending token only)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PendingToken' } },
          },
        },
        responses: {
          '200': { description: 'Code re-sent' },
          '400': { description: 'Email OTP is not enabled for this account' },
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
        summary: 'Disable TOTP 2FA (password + authenticator reauth, wipes secret, kills sessions)',
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
        summary: 'List admins (perm: admin.read, paginated + tab counts in meta)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          {
            name: 'status',
            in: 'query',
            schema: {
              type: 'string',
              enum: ['Active', 'Suspended', 'Disabled', 'ACTIVE', 'SUSPENDED', 'DISABLED'],
            },
            description: 'Absent = all tabs',
          },
          {
            name: 'role',
            in: 'query',
            schema: { type: 'string' },
            description: 'Role key, e.g. support',
          },
          {
            name: 'search',
            in: 'query',
            schema: { type: 'string' },
            description: 'Matches email + name (min 2 chars client-side)',
          },
          { name: 'sort', in: 'query', schema: { type: 'string', default: 'createdAt:desc' } },
        ],
        responses: {
          '200': {
            description:
              'Admin list; meta.counts = { total, active, suspended, disabled } + meta.twoFactorEnabled',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/AdminListItem' } },
            },
          },
          '403': { description: 'Forbidden' },
        },
      },
      post: {
        tags: ['admin'],
        summary: 'Create admin (perm: admin.create; super_admin grants need Super Admin)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateAdminRequest' } },
          },
        },
        responses: {
          '201': {
            description: 'Created (never returns the password; inviteSent=false in phase 1)',
          },
          '403': { description: 'Escalation blocked (details.code=SUPER_ADMIN_GRANT_FORBIDDEN)' },
          '409': { description: 'Email exists (details.code=EMAIL_IN_USE)' },
          '422': { description: 'Weak password / unknown role (details.field + details.code)' },
        },
      },
    },
    '/admin/admins/summary': {
      get: {
        tags: ['admin'],
        summary: 'Team strip counts (perm: admin.read)',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: '{ total, active, suspended, disabled, needsAttention, twoFactorEnabled }',
          },
        },
      },
    },
    '/admin/admins/check-email': {
      get: {
        tags: ['admin'],
        summary: 'Live email-uniqueness check for the Create dialog (perm: admin.read)',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'email',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'email' },
          },
        ],
        responses: { '200': { description: '{ available: boolean }' } },
      },
    },
    '/admin/admins/password/generate': {
      post: {
        tags: ['admin'],
        summary: 'Generate a policy-accepted temp password (perm: admin.create)',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: '{ password } — 16 chars, CSPRNG' } },
      },
    },
    '/admin/admins/{id}': {
      get: {
        tags: ['admin'],
        summary: 'Admin detail + session count + last 5 audit entries (perm: admin.read)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'AdminDetail (AdminListItem + activeSessionsCount + recentActivity)',
          },
          '404': { description: 'Unknown id (details.code=ADMIN_NOT_FOUND)' },
        },
      },
    },
    '/admin/admins/{id}/status': {
      patch: {
        tags: ['admin'],
        summary: 'Suspend/disable/reactivate (perm: admin.suspend; never self or last Super Admin)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SetStatusRequest' } },
          },
        },
        responses: {
          '200': { description: '{ id, status, updatedAt }. DISABLED revokes all sessions' },
          '403': { description: 'Self-change (details.code=CANNOT_CHANGE_OWN_STATUS)' },
          '409': { description: 'Last active Super Admin (details.code=LAST_SUPER_ADMIN)' },
        },
      },
    },
    '/admin/admins/{id}/revoke-sessions': {
      post: {
        tags: ['admin'],
        summary:
          'Revoke ALL sessions for one admin (perm: session.revoke; never touches caller cookie)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: '{ revokedCount } + tokenVersion bump + session.revoke audit' },
          '404': { description: 'Unknown id' },
        },
      },
    },
    '/admin/admins/{id}/roles': {
      put: {
        tags: ['admin'],
        summary: 'Replace roles (perm: role.assign; escalation + self-lockout guarded)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SetRolesRequest' } },
          },
        },
        responses: {
          '200': { description: '{ roles, added, removed }' },
          '403': { description: 'Escalation or own-SA removal' },
          '409': { description: 'Last active Super Admin' },
        },
      },
    },
    '/admin/permissions': {
      get: {
        tags: ['admin'],
        summary:
          'Grouped permission catalog for the checkbox matrix — read-only, keys are code-defined (perm: role.read)',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'Permission groups (Admins, Roles, Activity, Sessions)',
          },
        },
      },
    },
    '/admin/permissions/list': {
      get: {
        tags: ['admin'],
        summary: 'Flat permission list with role counts, ?status=ACTIVE|INACTIVE (perm: role.read)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] } },
        ],
        responses: { '200': { description: 'Permission list' } },
      },
    },
    '/admin/permissions/me': {
      get: {
        tags: ['admin'],
        summary: 'Own effective permissions for the frontend can() helper (auth-only)',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: '{ permissions: string[] } sorted' } },
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
        summary:
          'Create role — defaults to all ACTIVE permissions, pass permissionKeys to override (perm: role.create; key is a permanent slug)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CreateRoleRequest' } },
          },
        },
        responses: { '201': { description: 'Created role (assign permissions next)' } },
      },
    },
    '/admin/roles/{key}': {
      get: {
        tags: ['admin'],
        summary: 'Get one role with permissions (perm: role.read)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Role detail' }, '404': { description: 'Not found' } },
      },
      patch: {
        tags: ['admin'],
        summary:
          'Edit role name/description only — key is permanent, no delete (perm: role.update; super_admin is Super-Admin-only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/UpdateRoleRequest' } },
          },
        },
        responses: { '200': { description: 'Updated role' } },
      },
      delete: {
        tags: ['admin'],
        summary: 'Delete a custom role (system + assigned are protected; Super-Admin-only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Deleted' },
          '409': { description: 'Role has assignments' },
        },
      },
    },
    '/admin/roles/{key}/clone': {
      post: {
        tags: ['admin'],
        summary: 'Clone a role with its active grants (perm: role.create)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CloneRoleRequest' } },
          },
        },
        responses: { '201': { description: 'Cloned role' } },
      },
    },
    '/admin/roles/{key}/status': {
      patch: {
        tags: ['admin'],
        summary: 'Activate/deactivate a role — INACTIVE grants nothing (perm: role.update)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SetRoleStatusRequest' } },
          },
        },
        responses: { '200': { description: 'Updated role' } },
      },
    },
    '/admin/roles/{key}/permissions': {
      put: {
        tags: ['admin'],
        summary:
          'Replace role permissions (perm: role.update; super_admin role is Super-Admin-only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SetPermissionsRequest' } },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      post: {
        tags: ['admin'],
        summary:
          'Add permissions to a role without touching existing grants — idempotent (perm: role.update; super_admin role is Super-Admin-only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SetPermissionsRequest' } },
          },
        },
        responses: {
          '200': { description: '{ added, alreadyGranted, permissions, role }' },
          '400': { description: 'Unknown/inactive key or empty list' },
        },
      },
      delete: {
        tags: ['admin'],
        summary:
          'Remove permissions from a role without touching other grants — idempotent (perm: role.update; super_admin role is Super-Admin-only)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'key', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/SetPermissionsRequest' } },
          },
        },
        responses: {
          '200': { description: '{ removed, alreadyGranted (not held), permissions, role }' },
        },
      },
    },
    '/admin/audit-log': {
      get: {
        tags: ['admin'],
        summary:
          'Query audit trail (perm: audit.read, paginated, ?action=&resourceType=&resourceId=)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'resourceType', in: 'query', schema: { type: 'string' } },
          { name: 'resourceId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Audit entries' } },
      },
    },
    '/admin/activity': {
      get: {
        tags: ['admin'],
        summary: 'Activity feed: snapshot entries + derived diffs, newest first (perm: audit.read)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          {
            name: 'action',
            in: 'query',
            schema: { type: 'string' },
            description: 'Feed key (e.g. role.permissions_updated); repeatable = OR',
          },
          {
            name: 'q',
            in: 'query',
            schema: { type: 'string' },
            description: 'Substring over actor, resource, IP, action + label',
          },
          {
            name: 'actor',
            in: 'query',
            schema: { type: 'string' },
            description: 'Exact actor email or id',
          },
          {
            name: 'from',
            in: 'query',
            schema: { type: 'string', example: '2026-09-01' },
            description: 'YYYY-MM-DD inclusive, start of day UTC',
          },
          {
            name: 'to',
            in: 'query',
            schema: { type: 'string', example: '2026-09-30' },
            description: 'YYYY-MM-DD inclusive, end of day UTC',
          },
          {
            name: 'sort',
            in: 'query',
            schema: { type: 'string', enum: ['newest', 'oldest'], default: 'newest' },
          },
        ],
        responses: {
          '200': { description: 'Paginated ActivityEntry list' },
          '400': { description: 'Bad page/limit/sort/date, or from after to' },
        },
      },
    },
    '/admin/activity/actions': {
      get: {
        tags: ['admin'],
        summary:
          'Feed filter options: distinct actions + counts honoring q/actor/from/to (perm: audit.read)',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'q',
            in: 'query',
            schema: { type: 'string' },
            description: 'Same free-text filter as the list endpoint',
          },
          { name: 'actor', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string' } },
          { name: 'to', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'ActionOption list (empty when no entries)' } },
      },
    },
    '/admin/activity/{id}': {
      get: {
        tags: ['admin'],
        summary: 'Single activity entry for deep links / full diffs (perm: audit.read)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'ActivityEntry' },
          '404': { description: 'Unknown entry id' },
        },
      },
    },
  },
} as const;
