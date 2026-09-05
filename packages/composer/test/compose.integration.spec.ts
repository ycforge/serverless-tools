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

    const serialized = JSON.stringify(result.document);
    expect(serialized).not.toMatch(/own|owner|provenance|app_id|appId/i);
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