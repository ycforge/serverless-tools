import { describe, expect, it } from 'vitest';

import {
  PML_IDENTITY_COLLISION,
  type App,
  type Resource,
} from '../../src/contracts/index.js';
import { checkIdentityCollision, extractResources } from '../../src/model/resources.js';
import { parseYaml } from '../../src/model/parse.js';
import type { ResourcesResult } from '../../src/model/resources.js';

// US-1 AC2 / FR-002: resources.yaml → domain-grouped Resource records —
// external, reference only (Constitution VI). Unknown domains are generic
// groups (research decision 11 / spec 019 forward-compat). plan Q1: identity
// collision is functions-domain app_id ↔ resource_id (data-model.md).

function parseResources(text: string, file = '.ycsf/resources.yaml'): ResourcesResult {
  const parsed = parseYaml(text, file);
  if (parsed.kind !== 'ok') {
    return { kind: 'invalid', errors: parsed.errors };
  }
  return extractResources(parsed.data, file);
}

function toMapOf(docs: ResourcesResult) {
  return docs.kind === 'ok' ? docs.resources : new Map();
}

describe('extractResources (US-1, FR-002, FR-013)', () => {
  it('groups resources by domain (queues/buckets/functions)', () => {
    const text = `version: 1
queues:
  events: {}
buckets:
  frontend: {}
functions:
  legacy_authorizer: {}
`;
    const result = parseResources(text);
    expect(result.kind).toBe('ok');
    const resources = toMapOf(result);
    expect(resources.get('queues')?.get('events')).toEqual({
      domain: 'queues',
      resource_id: 'events',
      properties: {},
    });
    expect(resources.get('queues')?.get('events')).toMatchObject({
      domain: 'queues',
      resource_id: 'events',
    });
    expect(resources.get('buckets')?.get('frontend')).toMatchObject({ resource_id: 'frontend' });
    expect(resources.get('functions')?.get('legacy_authorizer')).toMatchObject({
      resource_id: 'legacy_authorizer',
    });
  });

  it('treats unknown top-level domains as generic resource groups (plan Q1, spec 019)', () => {
    const text = 'version: 1\ntopics:\n  news: {}\n';
    const result = parseResources(text);
    expect(result.kind).toBe('ok');
    const resources = toMapOf(result);
    const topic = resources.get('topics')?.get('news') as Resource | undefined;
    expect(topic).toMatchObject({ domain: 'topics', resource_id: 'news' });
  });

  it('accepts an empty resources.yaml with an empty model (spec Edge Case)', () => {
    const result = parseResources('version: 1\n');
    expect(result.kind).toBe('ok');
    expect(toMapOf(result).size).toBe(0);
  });
});

describe('checkIdentityCollision (US-3 AC1, FR-008, data-model.md Decision)', () => {
  function appsWith(id: string): ReadonlyMap<string, App> {
    return new Map([
      [
        id,
        { app_id: id, source_path: id, builder: 'nestjs-function', depends_on: [] },
      ],
    ]);
  }

  it('flags app_id === functions-domain resource_id with PML_IDENTITY_COLLISION', () => {
    const apps = appsWith('legacy_authorizer');
    const resources = new Map<string, ReadonlyMap<string, Resource>>([
      [
        'functions',
        new Map([['legacy_authorizer', { domain: 'functions', resource_id: 'legacy_authorizer', properties: {} }]]),
      ],
    ]);
    const diagnostics = checkIdentityCollision(apps, resources);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: PML_IDENTITY_COLLISION,
      app: 'legacy_authorizer',
      identity: 'functions.legacy_authorizer',
      file: '.ycsf/apps.yaml',
    });
  });

  it('flags functions.<app_id> colliding with a functions.<resource_id> (same identity)', () => {
    const apps = appsWith('my_func');
    const resources = new Map<string, ReadonlyMap<string, Resource>>([
      [
        'functions',
        new Map([['my_func', { domain: 'functions', resource_id: 'my_func', properties: {} }]]),
      ],
    ]);
    const diagnostics = checkIdentityCollision(apps, resources);
    expect(diagnostics[0]?.code).toBe(PML_IDENTITY_COLLISION);
    expect(diagnostics[0]?.identity).toBe('functions.my_func');
  });

  it('does NOT flag a same-named resource in a non-functions domain (queues)', () => {
    const apps = appsWith('events');
    const resources = new Map<string, ReadonlyMap<string, Resource>>([
      [
        'queues',
        new Map([['events', { domain: 'queues', resource_id: 'events', properties: {} }]]),
      ],
    ]);
    expect(checkIdentityCollision(apps, resources)).toEqual([]);
  });
});