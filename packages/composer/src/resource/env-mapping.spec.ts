import { describe, expect, it } from 'vitest';

import { parseResourceIndex } from './resource-index.js';
import { parseEnvMapping, loadEnvMapping } from './env-mapping.js';
import { RESOURCE_REF_ERROR_CODES, ResourceRefError } from './errors.js';
import type { EnvMapping, ResourceIndex } from './types.js';

const INDEX_YAML = `
version: 1
functions:
  legacy_authorizer: {}
queues:
  events: {}
buckets:
  frontend: {}
`;

function indexFromText(text: string): ResourceIndex {
  return parseResourceIndex(text, '/p/.ycsf/resources.yaml');
}

function envFromText(text: string, index: ResourceIndex): EnvMapping {
  return parseEnvMapping(text, '/p/.ycsf/env.yaml', index);
}

describe('env-mapping — load valid env.yaml (T020, US4/AC1..AC2/AC4, FR-009/010/012/020, SC-005)', () => {
  const INDEX = indexFromText(INDEX_YAML);

  it('canonical env.yaml builds an EnvMapping; getEnvVar/hasEntry resolve', () => {
    const env = envFromText(
      `
version: 1
functions:
  legacy_authorizer:
    id:
      env: LEGACY_AUTHORIZER_ID
`,
      INDEX,
    );
    expect(env.hasEntry('functions', 'legacy_authorizer', 'id')).toBe(true);
    expect(env.getEnvVar('functions', 'legacy_authorizer', 'id')).toBe('LEGACY_AUTHORIZER_ID');
    expect(env.hasEntry('functions', 'ghost', 'id')).toBe(false);
  });

  it('absent file → empty mapping, NO error', async () => {
    const env = await loadEnvMapping('/nonexistent/composition/root', INDEX);
    expect(env.hasEntry('functions', 'anything', 'anything')).toBe(false);
  });

  it('empty entry set is a valid empty mapping', () => {
    const env = envFromText('version: 1\n', INDEX);
    expect(env.hasEntry('functions', 'legacy_authorizer', 'id')).toBe(false);
  });

  it('unused entries (declared but unused by any reference-bearing field) → allowed, not an error (Env cases)', () => {
    const env = envFromText(
      `
version: 1
functions:
  legacy_authorizer:
    id:
      env: LEGACY_AUTHORIZER_ID
queues:
  events:
    qurl:
      env: EVENTS_QUEUE_URL
`,
      INDEX,
    );
    expect(env.hasEntry('queues', 'events', 'qurl')).toBe(true);
  });
});

describe('env-mapping — validation fail-fast (T020, US4/AC3/AC5, FR-012/020, SC-005)', () => {
  const INDEX = indexFromText(INDEX_YAML);

  it('version: 2 → RESOURCE_REF_VERSION_UNSUPPORTED with filePath + version', () => {
    expect(() => envFromText('version: 2\nfunctions:\n  legacy_authorizer:\n    id:\n      env: V\n', INDEX)).toThrow(
      expect.objectContaining({ code: 'RESOURCE_REF_VERSION_UNSUPPORTED', version: '2' }),
    );
  });

  it('default: field → RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED (FR-020)', () => {
    expect(() =>
      envFromText(
        `
version: 1
functions:
  legacy_authorizer:
    id:
      env: LEGACY_AUTHORIZER_ID
      default: d4e123
`,
        INDEX,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'RESOURCE_REF_ENV_DEFAULT_UNSUPPORTED',
        context: expect.objectContaining({ domain: 'functions', name: 'legacy_authorizer', property: 'id' }),
      }),
    );
  });

  it('env.yaml references a resource NOT declared in resources.yaml index → RESOURCE_REF_ENV_UNDECLARED_RESOURCE (FR-012)', () => {
    expect(() =>
      envFromText(
        `
version: 1
functions:
  ghost_authorizer:
    id:
      env: GHOST_AUTHORIZER_ID
`,
        INDEX,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'RESOURCE_REF_ENV_UNDECLARED_RESOURCE',
        context: expect.objectContaining({ domain: 'functions', name: 'ghost_authorizer', property: 'id' }),
      }),
    );
  });

  it('env.yaml references a property invalid for the domain → RESOURCE_REF_ENV_UNDECLARED_RESOURCE (FR-012)', () => {
    expect(() =>
      envFromText(
        `
version: 1
queues:
  events:
    name:
      env: EVENTS_NAME
`,
        INDEX,
      ),
    ).toThrow(expect.objectContaining({ code: 'RESOURCE_REF_ENV_UNDECLARED_RESOURCE' }));
  });

  it('unknown domain in env.yaml → RESOURCE_REF_DOMAIN_UNKNOWN', () => {
    expect(() =>
      envFromText('version: 1\ndatabases:\n  legacy:\n    id:\n      env: X\n', INDEX),
    ).toThrow(expect.objectContaining({ code: 'RESOURCE_REF_DOMAIN_UNKNOWN' }));
  });

  it('leaf without env → RESOURCE_REF_INVALID_YAML', () => {
    expect(() =>
      envFromText('version: 1\nfunctions:\n  legacy_authorizer:\n    id: {}\n', INDEX),
    ).toThrow(expect.objectContaining({ code: 'RESOURCE_REF_INVALID_YAML' }));
  });
});

describe('env-mapping — seam 009→011: app-vs-resource collision NOT enforced by B (T028, FR-016, SC-006)', () => {
  it('RESOURCE_REF_COLLISION_APPS_RESOURCES code is part of the taxonomy but B never throws it (B does not read apps.yaml)', () => {
    expect(RESOURCE_REF_ERROR_CODES).toContain('RESOURCE_REF_COLLISION_APPS_RESOURCES');
    expect(() => new ResourceRefError('RESOURCE_REF_COLLISION_APPS_RESOURCES', {})).not.toThrow();
  });
});
