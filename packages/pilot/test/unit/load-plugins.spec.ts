import { describe, expect, it } from 'vitest';

import {
  BRG_LOAD_ERROR,
  BRG_NOT_A_PLUGIN,
  BRG_PACKAGE_NOT_FOUND,
} from '../../src/contracts/index.js';
import { loadPlugins } from '../../src/registry/load.js';
import {
  createFixtureBuilder,
  createFixtureBoth,
  createFixtureLoadError,
  createFixtureMaterializer,
  createFixtureNotAPlugin,
} from '../helpers/registry-fixtures.js';

// T023–T030: loadPlugins unit tests (US-3/4, FR-007..011/015)

describe('loadPlugins', () => {
  it('T023: valid builder fixture (default export, build fn) → PluginEntry kind: builder (FR-007, US-3 AC2)', async () => {
    const path = createFixtureBuilder('t023-builder');
    const entries = new Map([['builder-a', { id: 'builder-a', packageName: path, kind: 'builder' as const }]]);
    const result = await loadPlugins(entries);
    expect(result.errors).toHaveLength(0);
    expect(result.entries.size).toBe(1);
    const entry = result.entries.get('builder-a');
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('builder');
    expect(entry?.id).toBe('builder-a');
    expect(entry?.packageName).toBe(path);
    expect(entry?.module).toBeDefined();
  });

  it('T024: valid builder (named export, build fn) → PluginEntry kind: builder (FR-007, US-3 AC2)', async () => {
    const path = createFixtureBuilder('t024-named-builder', 'named');
    const entries = new Map([['builder-n', { id: 'builder-n', packageName: path, kind: 'builder' as const }]]);
    const result = await loadPlugins(entries);
    expect(result.errors).toHaveLength(0);
    expect(result.entries.get('builder-n')?.kind).toBe('builder');
  });

  it('T025: valid materializer fixture (default export, supports+materialize) → kind: materializer (FR-008)', async () => {
    const path = createFixtureMaterializer('t025-mat');
    const entries = new Map([['mat-a', { id: 'mat-a', packageName: path, kind: 'materializer' as const }]]);
    const result = await loadPlugins(entries);
    expect(result.errors).toHaveLength(0);
    expect(result.entries.get('mat-a')?.kind).toBe('materializer');
  });

  it('T026: not-a-plugin fixture → BRG_NOT_A_PLUGIN (FR-010, US-4 AC1)', async () => {
    const path = createFixtureNotAPlugin();
    const entries = new Map([['nap', { id: 'nap', packageName: path, kind: 'builder' as const }]]);
    const result = await loadPlugins(entries);
    expect(result.entries.size).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe(BRG_NOT_A_PLUGIN);
    expect(result.errors[0]?.id).toBe('nap');
  });

  it('T027: nonexistent package → BRG_PACKAGE_NOT_FOUND (FR-009, US-3 AC1)', async () => {
    const entries = new Map([
      ['fake', { id: 'fake', packageName: '@nonexistent/fake-builder', kind: 'builder' as const }],
    ]);
    const result = await loadPlugins(entries);
    expect(result.entries.size).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe(BRG_PACKAGE_NOT_FOUND);
    expect(result.errors[0]?.packageName).toBe('@nonexistent/fake-builder');
  });

  it('T028: load-error fixture (top-level throw) → BRG_LOAD_ERROR (FR-011, Sc7)', async () => {
    const path = createFixtureLoadError();
    const entries = new Map([['le', { id: 'le', packageName: path, kind: 'builder' as const }]]);
    const result = await loadPlugins(entries);
    expect(result.entries.size).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe(BRG_LOAD_ERROR);
  });

  it('T029: both-shape fixture → kind: builder (builder-priority, research 2)', async () => {
    const path = createFixtureBoth();
    const entries = new Map([['both', { id: 'both', packageName: path, kind: 'builder' as const }]]);
    const result = await loadPlugins(entries);
    expect(result.errors).toHaveLength(0);
    expect(result.entries.get('both')?.kind).toBe('builder');
  });

  it('T030: partial load — 3 entries, 1 valid + 1 not-found + 1 load-error → both errors collected (FR-015)', async () => {
    const goodPath = createFixtureBuilder('t030-good');
    const errorPath = createFixtureLoadError();
    const entries = new Map<string, { id: string; packageName: string; kind: 'builder' }>([
      ['good', { id: 'good', packageName: goodPath, kind: 'builder' }],
      ['nf', { id: 'nf', packageName: '@nonexistent/pkg', kind: 'builder' }],
      ['le', { id: 'le', packageName: errorPath, kind: 'builder' }],
    ]);
    const result = await loadPlugins(entries);
    // valid entry still loaded
    expect(result.entries.size).toBe(1);
    expect(result.entries.get('good')).toBeDefined();
    // both errors collected
    expect(result.errors).toHaveLength(2);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain(BRG_PACKAGE_NOT_FOUND);
    expect(codes).toContain(BRG_LOAD_ERROR);
  });
});
