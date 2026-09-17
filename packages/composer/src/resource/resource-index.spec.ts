import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadResourceIndex, parseResourceIndex } from './resource-index.js';

const FIXTURE = (name: string) => fileURLToPath(new URL(`../../test/fixtures/${name}/`, import.meta.url));

const CANONICAL = `
version: 1
functions:
  legacy_authorizer: {}
queues:
  events: {}
buckets:
  frontend: {}
containers:
  worker: {}
gateways:
  main: {}
`;

async function expectRejectsCode(yamlText: string, code: string): Promise<void> {
  await expect(async () => parseResourceIndex(yamlText, '/p/.ycsf/resources.yaml')).rejects.toMatchObject(
    { name: 'ResourceRefError', code },
  );
}

describe('resource-index — build from valid resources.yaml (T008, US1/AC1, FR-001/004, SC-002)', () => {
  it('canonical document with all 5 domains builds an index and resolves the logical references', () => {
    const index = parseResourceIndex(CANONICAL, '/p/.ycsf/resources.yaml');
    expect(index.has('queues', 'events')).toBe(true);
    expect(index.has('functions', 'legacy_authorizer')).toBe(true);
    expect(index.getProperties('functions', 'legacy_authorizer')).toEqual(new Set(['id']));
    expect(index.getProperties('queues', 'events')).toEqual(new Set(['qurl']));
    expect(index.getProperties('buckets', 'frontend')).toEqual(new Set(['name']));
    expect(index.getProperties('containers', 'worker')).toEqual(new Set(['id']));
    expect(index.getProperties('gateways', 'main')).toEqual(new Set(['id']));
    expect(index.validateProperty('queues', 'events', 'name')).toBe(false);
    expect(index.validateProperty('queues', 'events', 'qurl')).toBe(true);
    expect(index.isValidProperty('queues', 'qurl')).toBe(true);
    expect(index.isValidProperty('queues', 'name')).toBe(false);
  });

  it('empty entry set (version: 1, no records) is a valid empty index', () => {
    const index = parseResourceIndex('version: 1\n', '/p/.ycsf/resources.yaml');
    expect(index.has('functions', 'anything')).toBe(false);
    expect([...index.domains]).toEqual([]);
  });

  it('absent file → empty index, NO error (FR-001)', async () => {
    const index = await loadResourceIndex('/nonexistent/composition/root');
    expect(index.has('functions', 'anything')).toBe(false);
  });

  it('present-but-empty file is not a valid YAML map → RESOURCE_REF_INVALID_YAML', async () => {
    await expect(async () => parseResourceIndex('', '/p/.ycsf/resources.yaml')).rejects.toMatchObject({
      name: 'ResourceRefError',
      code: 'RESOURCE_REF_INVALID_YAML',
    });
  });
});

describe('resource-index — fail-fast taxonomy (T008, US1/AC2-AC5, FR-001..004)', () => {
  it('version: 2 → RESOURCE_REF_VERSION_UNSUPPORTED with filePath + version', async () => {
    await expect(async () =>
      parseResourceIndex('version: 2\nfunctions:\n  auth: {}\n', '/p/.ycsf/resources.yaml'),
    ).rejects.toMatchObject({
      name: 'ResourceRefError',
      code: 'RESOURCE_REF_VERSION_UNSUPPORTED',
      filePath: '/p/.ycsf/resources.yaml',
      version: '2',
    });
  });

  it('duplicate domain.name → RESOURCE_REF_IDENTITY_COLLISION with domain + name', async () => {
    await expect(async () =>
      parseResourceIndex(
        'version: 1\nfunctions:\n  auth: {}\n  auth: {}\n',
        '/p/.ycsf/resources.yaml',
      ),
    ).rejects.toMatchObject({
      name: 'ResourceRefError',
      code: 'RESOURCE_REF_IDENTITY_COLLISION',
      context: { domain: 'functions', name: 'auth' },
    });
  });

  it('unknown domain → RESOURCE_REF_DOMAIN_UNKNOWN', async () => {
    await expect(async () =>
      parseResourceIndex('version: 1\ndatabases:\n  legacy: {}\n', '/p/.ycsf/resources.yaml'),
    ).rejects.toMatchObject({
      name: 'ResourceRefError',
      code: 'RESOURCE_REF_DOMAIN_UNKNOWN',
      domain: 'databases',
    });
  });

  it('invalid property for domain → RESOURCE_REF_PROPERTY_INVALID with allowed set', async () => {
    await expect(async () =>
      parseResourceIndex('version: 1\nqueues:\n  events:\n    name: {}\n', '/p/.ycsf/resources.yaml'),
    ).rejects.toMatchObject({
      name: 'ResourceRefError',
      code: 'RESOURCE_REF_PROPERTY_INVALID',
      context: { domain: 'queues', name: 'events', property: 'name', allowedProperties: ['qurl'] },
    });
  });

  it('non-object resource value → fail-fast (FR-001)', async () => {
    await expect(async () =>
      parseResourceIndex('version: 1\nqueues:\n  events: not-an-object\n', '/p/.ycsf/resources.yaml'),
    ).rejects.toMatchObject({ name: 'ResourceRefError', code: 'RESOURCE_REF_INVALID_YAML' });
  });

  it('non-object domain value → fail-fast', async () => {
    await expect(async () =>
      parseResourceIndex('version: 1\nqueues: 42\n', '/p/.ycsf/resources.yaml'),
    ).rejects.toMatchObject({ name: 'ResourceRefError', code: 'RESOURCE_REF_INVALID_YAML' });
  });

  it('malformed YAML → RESOURCE_REF_INVALID_YAML', async () => {
    await expectRejectsCode('version: 1\nqueues: [unclosed', 'RESOURCE_REF_INVALID_YAML');
  });
});

describe('resource-index — byte-parity (T009, FR-001, SC-002)', () => {
  it('loading a fixture leaves the source YAML bytes identical', async () => {
    const resourcesPath = fileURLToPath(
      new URL('../../test/fixtures/resource-valid/.ycsf/resources.yaml', import.meta.url),
    );
    const before = await readFile(resourcesPath, 'utf8');
    const index = await loadResourceIndex(FIXTURE('resource-valid'));
    const after = await readFile(resourcesPath, 'utf8');
    expect(index.has('functions', 'legacy_authorizer')).toBe(true);
    expect(after).toBe(before);
  });
});