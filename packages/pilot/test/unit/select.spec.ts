import { describe, expect, it } from 'vitest';

import { MTL_COLLISION, MTL_UNHANDLED_ARTIFACT } from '../../src/contracts/index.js';
import { selectArtifacts } from '../../src/materialize/select.js';
import {
  canonicalAppsYaml,
  appsModel,
  makeMaterializer,
  makeRegistry,
  materializerEntry,
  matDocker,
  matNest,
  matVite,
} from '../helpers/materialize-fixtures.js';

// T015–T018: select.spec.ts — Phase 1 selection, collect-all, empty
// registry, throwing supports (FR-002/003/017, A2).

describe('select.ts', () => {
  it('T015: two supporters → MTL_COLLISION with both ids in registry insertion order (FR-003)', () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`);
    const m1 = makeMaterializer('m1', { supportedTypes: ['nestjs-function'] });
    const m2 = makeMaterializer('m2', { supportedTypes: ['nestjs-function'] });
    const registry = makeRegistry([materializerEntry(m1), materializerEntry(m2)]);

    const result = selectArtifacts(model, registry);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        code: MTL_COLLISION,
        artifactId: 'user_service',
        type: 'nestjs-function',
        materializerIds: ['m1', 'm2'],
      });
    }
    expect(m1.spy.count.supports).toBe(1);
    expect(m2.spy.count.supports).toBe(1);
  });

  it('T016: no supporter → MTL_UNHANDLED_ARTIFACT with artifact id, type and ALL registered ids (FR-004)', () => {
    const model = appsModel(`version: 1
apps:
  analytics: { source_path: analytics, builder: docker }
`);
    const registry = makeRegistry([materializerEntry(matNest())]);

    const result = selectArtifacts(model, registry);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.errors[0]).toMatchObject({
        code: MTL_UNHANDLED_ARTIFACT,
        artifactId: 'analytics',
        type: 'docker',
        materializerIds: ['yandex-function'],
      });
    }
  });

  it('T017: selection collects ALL errors across artifacts (FR-017 collect-all), mixed collision+unhandled', () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
  openapi:      { source_path: openapi,      builder: yandex-api-gateway }
`);
    const m1 = makeMaterializer('m1', { supportedTypes: ['nestjs-function'] });
    const m2 = makeMaterializer('m2', { supportedTypes: ['nestjs-function'] });
    const registry = makeRegistry([materializerEntry(m1), materializerEntry(m2)]);

    const result = selectArtifacts(model, registry);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      const codes = result.errors.map((e) => e.code);
      expect(codes.filter((c) => c === MTL_COLLISION)).toHaveLength(1);
      expect(codes.filter((c) => c === MTL_UNHANDLED_ARTIFACT)).toHaveLength(1);
    }
  });

  it('T018: throwing supports propagates — selection never silently swallows (A2)', () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`);
    const throwing = makeMaterializer('boom', {
      supports: () => {
        throw new Error('supports exploded');
      },
    });
    const registry = makeRegistry([materializerEntry(throwing)]);

    expect(() => selectArtifacts(model, registry)).toThrow('supports exploded');
  });

  it('empty registry + apps → MTL_UNHANDLED_ARTIFACT with empty materializerIds (US-7, Sc7)', () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`);
    const registry = makeRegistry([]);

    const result = selectArtifacts(model, registry);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.errors[0]).toMatchObject({
        code: MTL_UNHANDLED_ARTIFACT,
        artifactId: 'user_service',
        materializerIds: [],
      });
    }
  });

  it('empty registry + 0 apps → ok with empty matches (US-7, Sc8)', () => {
    const model = appsModel(`version: 1
apps: {}
`);
    const result = selectArtifacts(model, makeRegistry([]));
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.matches.size).toBe(0);
    }
  });

  it('selection iterates registry records in insertion order, one supports call per materializer per artifact', () => {
    const model = appsModel(canonicalAppsYaml());
    const nest = matNest();
    const docker = matDocker();
    const vite = matVite();
    const gateway = makeMaterializer('gateway', { supportedTypes: ['yandex-api-gateway'] });
    const registry = makeRegistry([
      materializerEntry(nest),
      materializerEntry(docker),
      materializerEntry(vite),
      materializerEntry(gateway),
    ]);

    const result = selectArtifacts(model, registry);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect([...result.matches.entries()]).toEqual([
        ['analytics', 'yandex-container'],
        ['user_service', 'yandex-function'],
        ['frontend', 'vite-materializer'],
        ['openapi', 'gateway'],
      ]);
      expect(nest.spy.count.supports).toBe(4);
      expect(docker.spy.count.supports).toBe(4);
      expect(vite.spy.count.supports).toBe(4);
      expect(gateway.spy.count.supports).toBe(4);
    }
  });
});