import { describe, expect, it } from 'vitest';

import {
  PML_DEPENDS_CYCLE,
  PML_DEPENDS_SELF,
  PML_DEPENDS_UNKNOWN,
  type App,
} from '../../src/contracts/index.js';
import { buildDependsOnGraph } from '../../src/model/depends-on.js';

// US-2 / FR-005..007: depends_on graph built from all apps' depends_on.
// Iterative DFS white/gray/black (research decision 3): cycles, self-refs and
// dangling refs are all reported in ONE pass (collect-all, SC-002).

function appsOf(entries: Record<string, string[] | undefined>): App[] {
  return Object.entries(entries).map(([app_id, depends_on]) => ({
    app_id,
    source_path: app_id,
    builder: 'docker',
    depends_on: depends_on ?? [],
  }));
}

describe('buildDependsOnGraph — valid DAG (US-1 AC1, FR-005)', () => {
  it('builds adjacency + topologicalOrder for a valid DAG', () => {
    const apps = appsOf({ a: ['b'], b: ['c'], c: undefined });
    const result = buildDependsOnGraph(apps);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.graph.adjacency.get('a')).toEqual(['b']);
    expect(result.graph.adjacency.get('b')).toEqual(['c']);
    expect(result.graph.adjacency.get('c')).toEqual([]);
    const order = [...result.graph.topologicalOrder];
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('a'));
  });

  it('treats absent depends_on everywhere as all-independent (spec Edge Case)', () => {
    const apps = appsOf({ x: undefined, y: undefined });
    const result = buildDependsOnGraph(apps);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.graph.topologicalOrder).toHaveLength(2);
  });
});

describe('buildDependsOnGraph — cycles (US-2 AC1, FR-005, SC-002)', () => {
  it('reports PML_DEPENDS_CYCLE with the involved chain for a → b → c → a', () => {
    const apps = appsOf({ a: ['b'], b: ['c'], c: ['a'] });
    const result = buildDependsOnGraph(apps);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    const cycle = result.errors.find((e) => e.code === PML_DEPENDS_CYCLE);
    expect(cycle).toBeDefined();
    expect(cycle?.message).toContain('a');
    expect(cycle?.message).toContain('b');
    expect(cycle?.message).toContain('c');
    expect(result.graph.topologicalOrder).toHaveLength(0);
  });
});

describe('buildDependsOnGraph — self reference (US-2 AC2, FR-006)', () => {
  it('reports PML_DEPENDS_SELF for a → a', () => {
    const apps = appsOf({ a: ['a'] });
    const result = buildDependsOnGraph(apps);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    const self = result.errors.find((e) => e.code === PML_DEPENDS_SELF);
    expect(self).toBeDefined();
    expect(self).toMatchObject({ app: 'a', field: 'depends_on', file: '.ycsf/apps.yaml' });
    expect(self?.message).toContain('a');
  });
});

describe('buildDependsOnGraph — dangling reference (US-2 AC3, FR-007)', () => {
  it('reports PML_DEPENDS_UNKNOWN naming the unknown app', () => {
    const apps = appsOf({ a: ['nonexistent'] });
    const result = buildDependsOnGraph(apps);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    const unknown = result.errors.find((e) => e.code === PML_DEPENDS_UNKNOWN);
    expect(unknown).toBeDefined();
    expect(unknown).toMatchObject({ app: 'a', field: 'depends_on', file: '.ycsf/apps.yaml' });
    expect(unknown?.message).toContain('nonexistent');
  });
});

describe('buildDependsOnGraph — collect ALL (research decision 3, FR-015)', () => {
  it('reports a cycle AND a dangling ref in the same result', () => {
    const apps = appsOf({ a: ['b', 'nonexistent'], b: ['a'] });
    const result = buildDependsOnGraph(apps);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain(PML_DEPENDS_CYCLE);
    expect(codes).toContain(PML_DEPENDS_UNKNOWN);
  });
});