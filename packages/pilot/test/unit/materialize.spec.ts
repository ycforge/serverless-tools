import { describe, expect, it } from 'vitest';

import type { DispatchDiagnostic } from '../../src/contracts/index.js';
import { MTL_MATERIALIZE_FAILED } from '../../src/contracts/index.js';
import { materializeAll } from '../../src/materialize/materialize.js';
import {
  appsModel,
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
});