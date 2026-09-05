import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';

import { compose } from '../src/index.js';

const FIXTURE = (name: string) => fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));

const COMPOSE_APP = FIXTURE('compose-app');
const COMPOSE_APP_SINGLE = FIXTURE('compose-app-single');

const IN_COMPOSE_APP = (name: string) => `${COMPOSE_APP}participants/${name}`;
const IN_COMPOSE_APP_SINGLE = (name: string) => `${COMPOSE_APP_SINGLE}participants/${name}`;

const FUNCTIONS = ['internal_authorizer'];

describe('compose — integration fixtures (US1, FR-001/002/017)', () => {
  it('merges participant paths and components into a gateway document (US1/AC1)', async () => {
    const result = await compose({
      compositionRoot: COMPOSE_APP,
      apps: [
        { appRoot: IN_COMPOSE_APP('user_service') },
        { appRoot: IN_COMPOSE_APP('analytics') },
      ],
      functions: FUNCTIONS,
    });

    const paths = result.document.paths as Record<string, unknown>;
    const expected = ['/analytics/{id}', '/legacy', '/users', '/users/{id}'];
    for (const path of expected) {
      expect(paths).toHaveProperty(path);
    }

    const components = result.document.components as Record<string, unknown>;
    const schemas = components['schemas'] as Record<string, unknown>;
    expect(Object.keys(schemas).sort()).toEqual(['AnalyticsDto', 'UserDto']);
  });

  it('is deterministic: participant order does not change the gateway document (FR-017, SC-002)', async () => {
    const ordered = await compose({
      compositionRoot: COMPOSE_APP,
      apps: [
        { appRoot: IN_COMPOSE_APP('user_service') },
        { appRoot: IN_COMPOSE_APP('analytics') },
      ],
      functions: FUNCTIONS,
    });
    const reversed = await compose({
      compositionRoot: COMPOSE_APP,
      apps: [
        { appRoot: IN_COMPOSE_APP('analytics') },
        { appRoot: IN_COMPOSE_APP('user_service') },
      ],
      functions: FUNCTIONS,
    });

    expect(JSON.stringify(ordered.document)).toBe(JSON.stringify(reversed.document));
  });

  it('never leaks provenance into the serialized gateway document (FR-017, SC-004)', async () => {
    const result = await compose({
      compositionRoot: COMPOSE_APP,
      apps: [
        { appRoot: IN_COMPOSE_APP('user_service') },
        { appRoot: IN_COMPOSE_APP('analytics') },
      ],
      functions: FUNCTIONS,
    });

    const keys: string[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) {
          walk(item);
        }
        return;
      }
      if (typeof value === 'object' && value !== null) {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          keys.push(key);
          walk(child);
        }
      }
    };
    walk(result.document);
    expect(keys).not.toContain('owner');
    expect(keys).not.toContain('app');
    expect(keys).not.toContain('appId');
    expect(keys.filter((key) => /provenance/i.test(key))).toEqual([]);
  });

  it('exposes path → owner provenance for every merged path (FR-003, US1/AC3)', async () => {
    const result = await compose({
      compositionRoot: COMPOSE_APP,
      apps: [
        { appRoot: IN_COMPOSE_APP('user_service') },
        { appRoot: IN_COMPOSE_APP('analytics') },
      ],
      functions: FUNCTIONS,
    });

    expect(result.provenance.get('/users')).toBe('user_service');
    expect(result.provenance.get('/users/{id}')).toBe('user_service');
    expect(result.provenance.get('/legacy')).toBe('user_service');
    expect(result.provenance.get('/analytics/{id}')).toBe('analytics');
  });

  it('single-participant composition yields a valid gateway document (US1/AC2)', async () => {
    const result = await compose({
      compositionRoot: COMPOSE_APP_SINGLE,
      apps: [{ appRoot: IN_COMPOSE_APP_SINGLE('user_service') }],
    });

    expect(result.document.openapi).toBe('3.0.0');
    const schemas = (result.document.components as Record<string, unknown>)[
      'schemas'
    ] as Record<string, unknown>;
    expect(Object.keys(schemas)).toEqual(['UserDto']);
    expect(result.provenance.get('/users')).toBe('user_service');
  });
});

describe('compose — conflict fixtures (US2, FR-004/005/006/016)', () => {
  const FIXTURE_ROOT = (name: string) => FIXTURE(name);
  const participant = (name: string, app: string) =>
    `${FIXTURE_ROOT(name)}participants/${app}`;

  it('two apps declaring the same path → COMPOSE_PATH_COLLISION (US2/AC1)', async () => {
    await expect(
      compose({
        compositionRoot: FIXTURE_ROOT('compose-app-path-collision'),
        apps: [
          { appRoot: participant('compose-app-path-collision', 'user_service') },
          { appRoot: participant('compose-app-path-collision', 'analytics') },
        ],
      }),
    ).rejects.toMatchObject({
      name: 'ComposeError',
      code: 'COMPOSE_PATH_COLLISION',
      path: '/users',
      apps: ['analytics', 'user_service'],
    });
  });

  it('same operationId on different paths of two apps → COMPOSE_OPERATIONID_COLLISION (US2/AC2)', async () => {
    await expect(
      compose({
        compositionRoot: FIXTURE_ROOT('compose-app-opid-collision'),
        apps: [
          { appRoot: participant('compose-app-opid-collision', 'user_service') },
          { appRoot: participant('compose-app-opid-collision', 'analytics') },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'COMPOSE_OPERATIONID_COLLISION',
      operationId: 'listX',
      paths: ['/a', '/b'],
      apps: ['analytics', 'user_service'],
    });
  });

  it('duplicate operationId within ONE app → COMPOSE_OPERATIONID_COLLISION (edge)', async () => {
    await expect(
      compose({
        compositionRoot: FIXTURE_ROOT('compose-app-opid-self-collision'),
        apps: [{ appRoot: participant('compose-app-opid-self-collision', 'user_service') }],
      }),
    ).rejects.toMatchObject({
      code: 'COMPOSE_OPERATIONID_COLLISION',
      operationId: 'dup',
      paths: ['/a', '/b'],
    });
  });

  it('shared component name → COMPOSE_COMPONENT_COLLISION (US2/AC3)', async () => {
    await expect(
      compose({
        compositionRoot: FIXTURE_ROOT('compose-app-component-collision'),
        apps: [
          { appRoot: participant('compose-app-component-collision', 'user_service') },
          { appRoot: participant('compose-app-component-collision', 'analytics') },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'COMPOSE_COMPONENT_COLLISION',
      componentName: 'UserDto',
      apps: ['analytics', 'user_service'],
    });
  });

  it('openapi version mismatch → COMPOSE_OPENAPI_VERSION_MISMATCH (FR-016)', async () => {
    await expect(
      compose({
        compositionRoot: FIXTURE_ROOT('compose-app-version-mismatch'),
        apps: [
          { appRoot: participant('compose-app-version-mismatch', 'user_service') },
          { appRoot: participant('compose-app-version-mismatch', 'analytics') },
        ],
      }),
    ).rejects.toMatchObject({
      code: 'COMPOSE_OPENAPI_VERSION_MISMATCH',
      apps: ['analytics', 'user_service'],
      versions: ['3.0.0', '3.1.0'],
    });
  });

  it('empty apps list → COMPOSE_NO_PARTICIPANTS before any extraction (US2/AC4)', async () => {
    await expect(
      compose({
        compositionRoot: FIXTURE_ROOT('compose-app-no-participants'),
        apps: [],
      }),
    ).rejects.toMatchObject({ code: 'COMPOSE_NO_PARTICIPANTS' });
  });
});

describe('compose — overrides (US3, FR-007/008/009)', () => {
  const participant = (name: string, app: string) =>
    `${FIXTURE(name)}participants/${app}`;

  it('canonical fixture: global override sets info + adds /_health (owner "global"), local rules apply (US3/AC1/AC2/AC3)', async () => {
    const result = await compose({
      compositionRoot: FIXTURE('compose-app'),
      apps: [
        { appRoot: participant('compose-app', 'user_service') },
        { appRoot: participant('compose-app', 'analytics') },
      ],
      functions: ['internal_authorizer'],
    });

    expect(result.document.info).toEqual({ title: 'compose-app gateway', version: '1.0.0' });

    const paths = result.document.paths as Record<string, Record<string, unknown>>;
    expect(paths['/_health']).toEqual({
      get: { operationId: 'health', responses: { '200': { description: 'ok' } } },
    });
    expect(result.provenance.get('/_health')).toBe('global');

    expect(paths['/users']?.['get']).toEqual({ summary: 'user list' });
    expect(paths['/legacy']?.['get']).toBeUndefined();
    expect(result.provenance.get('/legacy')).toBe('user_service');
    expect(result.provenance.get('/analytics/{id}')).toBe('analytics');
  });

  it('local-override-added paths from two apps: byte-identical across participant order (FR-017, T042)', async () => {
    const composeRoot = FIXTURE('compose-app-ov-local-add');
    const userService = `${composeRoot}participants/user_service`;
    const analytics = `${composeRoot}participants/analytics`;

    const forward = await compose({
      compositionRoot: composeRoot,
      apps: [{ appRoot: userService }, { appRoot: analytics }],
    });
    const reversed = await compose({
      compositionRoot: composeRoot,
      apps: [{ appRoot: analytics }, { appRoot: userService }],
    });

    const expectedKeys = ['/analytics-extra', '/analytics/{id}', '/users', '/users-extra'];
    expect(Object.keys(forward.document.paths)).toEqual(expectedKeys);
    expect(Object.keys(reversed.document.paths)).toEqual(expectedKeys);
    expect(JSON.stringify(forward.document)).toBe(JSON.stringify(reversed.document));
    expect(forward.provenance.get('/analytics-extra')).toBe('analytics');
    expect(forward.provenance.get('/users-extra')).toBe('user_service');
  });

  it('absence of override files (global and local) is not an OVERRIDE_* error — pipeline reaches the info gate (T023)', async () => {
    await expect(
      compose({
        compositionRoot: FIXTURE('compose-app-path-collision'),
        apps: [{ appRoot: participant('compose-app-path-collision', 'user_service') }],
      }),
    ).rejects.toMatchObject({
      name: 'ComposeError',
      code: 'COMPOSE_INFO_MISSING',
    });
  });

  it('negative override fixtures → expected OVERRIDE_* codes', async () => {
    const cases: Array<[string, Record<string, unknown>, string[]]> = [
      ['compose-app-ov-bad-version', { code: 'OVERRIDE_VERSION_UNSUPPORTED' }, ['user_service']],
      ['compose-app-ov-rules-empty', { code: 'OVERRIDE_RULES_EMPTY' }, ['user_service']],
      ['compose-app-ov-value-missing', { code: 'OVERRIDE_VALUE_REQUIRED' }, ['user_service']],
      ['compose-app-ov-target-missing', { code: 'OVERRIDE_TARGET_MISSING' }, ['user_service']],
      ['compose-app-ov-add-existing', { code: 'OVERRIDE_TARGET_ALREADY_EXISTS' }, ['user_service']],
      [
        'compose-app-ov-local-out-of-scope',
        { code: 'OVERRIDE_OUT_OF_SCOPE', app: 'user_service' },
        ['user_service', 'analytics'],
      ],
      ['compose-app-ov-local-info', { code: 'OVERRIDE_OUT_OF_SCOPE', app: 'user_service' }, ['user_service']],
    ];

    for (const [name, expected, apps] of cases) {
      await expect(
        compose({
          compositionRoot: FIXTURE(name),
          apps: apps.map((app) => ({ appRoot: participant(name, app) })),
        }),
        name,
      ).rejects.toMatchObject(expected);
    }
  });
});

describe('compose — auth application (US4, FR-011/012/013)', () => {
  const participant = (name: string, app: string) =>
    `${FIXTURE(name)}participants/${app}`;

  it('canonical fixture (defaultScheme user/jwt) → root security [{ user: [] }] and exact jwt/function authorizers (US4/AC1/AC3)', async () => {
    const result = await compose({
      compositionRoot: FIXTURE('compose-app'),
      apps: [
        { appRoot: participant('compose-app', 'user_service') },
        { appRoot: participant('compose-app', 'analytics') },
      ],
      functions: ['internal_authorizer'],
    });

    expect(result.document.security).toEqual([{ user: [] }]);

    const securitySchemes = (result.document.components as Record<string, Record<string, unknown>>)[
      'securitySchemes'
    ] as Record<string, unknown>;
    expect(Object.keys(securitySchemes)).toEqual(['user', 'internal']);
    expect(securitySchemes['user']).toEqual({
      type: 'openIdConnect',
      openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration',
      'x-yc-apigateway-authorizer': {
        type: 'jwt',
        jwksUri: 'https://auth.example.com/jwks.json',
        issuers: ['https://auth.example.com'],
        audiences: ['my-api'],
        identitySource: { in: 'header', name: 'Authorization', prefix: 'Bearer ' },
      },
    });
    expect(securitySchemes['internal']).toEqual({
      type: 'http',
      scheme: 'bearer',
      'x-yc-apigateway-authorizer': {
        type: 'function',
        function_id: 'functions.internal_authorizer',
      },
    });
  });

  it('none schemes → no securitySchemes entry, no authorizer (US4/AC4)', async () => {
    const result = await compose({
      compositionRoot: FIXTURE('compose-app'),
      apps: [
        { appRoot: participant('compose-app', 'user_service') },
        { appRoot: participant('compose-app', 'analytics') },
      ],
      functions: ['internal_authorizer'],
    });

    const securitySchemes = (result.document.components as Record<string, Record<string, unknown>>)[
      'securitySchemes'
    ] as Record<string, unknown> | undefined;
    expect(securitySchemes?.['public']).toBeUndefined();
    expect(securitySchemes?.['frontend']).toBeUndefined();
  });

  it('root security + explicit op security preserved, replaced ops inherit via root (US4/AC1)', async () => {
    const result = await compose({
      compositionRoot: FIXTURE('compose-app'),
      apps: [
        { appRoot: participant('compose-app', 'user_service') },
        { appRoot: participant('compose-app', 'analytics') },
      ],
      functions: ['internal_authorizer'],
    });

    const paths = result.document.paths as Record<string, Record<string, { security?: unknown }>>;
    expect(paths['/users/{id}']?.['get']?.security).toEqual([{ user: [] }]);
    expect(paths['/analytics/{id}']?.['get']?.security).toEqual([{ user: [] }]);
    const overridden = paths['/users']?.['get'];
    expect(overridden).toEqual({ summary: 'user list' });
    expect(result.document.security).toEqual([{ user: [] }]);
  });

  it('defaultScheme type none → no root security emitted (US4/AC2)', async () => {
    const result = await compose({
      compositionRoot: FIXTURE('compose-app-default-public'),
      apps: [{ appRoot: participant('compose-app-default-public', 'user_service') }],
    });

    expect(result.document.security).toBeUndefined();
    const securitySchemes = (result.document.components as Record<string, Record<string, unknown>>)[
      'securitySchemes'
    ] as Record<string, unknown> | undefined;
    expect(securitySchemes?.['user']).toBeDefined();
  });

  it('operation referencing a none-type scheme → COMPOSE_SECURITY_REF_NONE_SCHEME (rule 9)', async () => {
    await expect(
      compose({
        compositionRoot: FIXTURE('compose-app-none-ref'),
        apps: [{ appRoot: participant('compose-app-none-ref', 'user_service') }],
      }),
    ).rejects.toMatchObject({
      name: 'ComposeError',
      code: 'COMPOSE_SECURITY_REF_NONE_SCHEME',
      route: 'GET /users',
      schemeName: 'anon',
    });
  });

  it('output contains no ${resources...} / provisioning artifacts (SC-006, FR-013/018)', async () => {
    const result = await compose({
      compositionRoot: FIXTURE('compose-app'),
      apps: [
        { appRoot: participant('compose-app', 'user_service') },
        { appRoot: participant('compose-app', 'analytics') },
      ],
      functions: ['internal_authorizer'],
    });

    const serialized = JSON.stringify(result.document);
    expect(serialized).not.toMatch(/\$\{resources/);
    expect(serialized).not.toMatch(/service_account_id/);
    expect(serialized).not.toMatch(/x-yc-apigateway-integration/);
  });
});

describe('compose — delegation of 006/007 errors (US5, FR-015, SC-007)', () => {
  const participant = (name: string, app: string) =>
    `${FIXTURE(name)}participants/${app}`;

  it('missing auth.yaml surfaces as AuthConfigError AUTH_FILE_MISSING, NOT ComposeError', async () => {
    await expect(
      compose({
        compositionRoot: FIXTURE('compose-app-bad-auth'),
        apps: [{ appRoot: participant('compose-app-bad-auth', 'user_service') }],
      }),
    ).rejects.toMatchObject({
      name: 'AuthConfigError',
      code: 'AUTH_FILE_MISSING',
    });
  });

  it('participant without source surfaces as OpenApiExtractError NO_SOURCE, NOT ComposeError', async () => {
    await expect(
      compose({
        compositionRoot: FIXTURE('compose-app-bad-extract'),
        apps: [{ appRoot: participant('compose-app-bad-extract', 'user_service') }],
      }),
    ).rejects.toMatchObject({
      name: 'OpenApiExtractError',
      code: 'NO_SOURCE',
    });
  });
});