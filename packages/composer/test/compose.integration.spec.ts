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