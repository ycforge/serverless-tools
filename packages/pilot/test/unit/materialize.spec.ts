import { describe, expect, it } from 'vitest';

import type { DispatchDiagnostic } from '../../src/contracts/index.js';
import { MTL_MATERIALIZE_FAILED } from '../../src/contracts/index.js';
import { materializeAll } from '../../src/materialize/materialize.js';
import {
  appsModel,
  makeMaterializer,
  makeRegistry,
  materializerEntry,
  matNest,
  matThrow,
} from '../helpers/materialize-fixtures.js';

// T022: materialize.spec.ts — Phase 2 abort-on-first (Sc6, FR-006, research 7).

describe('materializeAll', () => {
  it('T022: first artifact in topo order throws → MTL_MATERIALIZE_FAILED, later artifacts NOT materialized (abort-on-first, no partial results)', async () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
  frontend:     { source_path: frontend,     builder: vite }
`);
    // Alphabetical pre-sort (no deps): frontend < user_service → frontend materialized first.
    const nest = matNest();
    const throwing = matThrow('throw-materializer', ['vite']);
    const registry = makeRegistry([materializerEntry(nest), materializerEntry(throwing)]);

    const matches = new Map<string, string>([
      ['frontend', 'throw-materializer'],
      ['user_service', 'yandex-function'],
    ]);

    const result = await materializeAll(model, registry, matches);

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') return;
    const error: DispatchDiagnostic = result.error;
    expect(error.code).toBe(MTL_MATERIALIZE_FAILED);
    expect(error.artifactId).toBe('frontend');
    expect(error.materializerId).toBe('throw-materializer');
    expect(error.message).toContain('plugin crashed');

    expect(throwing.spy.count.materialize).toBe(1);
    expect(nest.spy.count.materialize).toBe(0);
  });

  it('T009: artifacts map threads value into the materialize descriptor (FR-003)', async () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`);
    const nest = matNest();
    const registry = makeRegistry([materializerEntry(nest)]);
    const matches = new Map([['user_service', 'yandex-function']]);

    const artifacts = new Map([
      ['user_service', { type: 'ycforge:function', value: { archivePath: 'dist/func.zip', entryPoint: 'index.handler' } }],
    ]);
    const result = await materializeAll(model, registry, matches, undefined, artifacts);

    expect(result.kind).toBe('ok');
    expect(nest.spy.materializeArtifacts).toHaveLength(1);
    expect(nest.spy.materializeArtifacts[0]).toMatchObject({ id: 'user_service' });
    expect(nest.spy.materializeArtifacts[0]?.value).toEqual({ archivePath: 'dist/func.zip', entryPoint: 'index.handler' });
  });

  it('T009/FR-007: materializer requiring value, without built artifacts → documented MTL_MATERIALIZE_FAILED, not a silent success', async () => {
    const model = appsModel(`version: 1
apps:
  frontend: { source_path: frontend, builder: vite }
`);
    const requiresValue = makeMaterializer('value-dependent', { supportedTypes: ['vite'], requiresValue: true });
    const registry = makeRegistry([materializerEntry(requiresValue)]);
    const matches = new Map([['frontend', 'value-dependent']]);

    const result = await materializeAll(model, registry, matches);

    expect(result.kind).toBe('failed');
    if (result.kind !== 'failed') return;
    expect(result.error.code).toBe(MTL_MATERIALIZE_FAILED);
    expect(result.error.artifactId).toBe('frontend');
    expect(result.error.materializerId).toBe('value-dependent');
    expect(result.error.message).toContain('value');
  });
});