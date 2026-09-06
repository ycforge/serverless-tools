import { describe, expect, it } from 'vitest';

import { BRG_UNKNOWN_BUILDER, type PluginRegistry } from '../../src/contracts/index.js';
import { validateBuilders } from '../../src/registry/validate.js';

// T031–T035: validateBuilders unit tests (US-5, FR-013)

function makeRegistry(...ids: string[]): PluginRegistry {
  const records = new Map(ids.map((id) => [id, { id, packageName: `pkg-${id}`, kind: 'builder' as const, module: {} }]));
  return { records };
}

function makeModel(apps: Record<string, string>) {
  const appMap = new Map(
    Object.entries(apps).map(([id, builder]) => [
      id,
      { app_id: id, source_path: id, builder, depends_on: [] as string[] },
    ]),
  );
  return {
    apps: appMap,
    resources: new Map(),
    build_configs: new Map(),
    env_requirements: new Map(),
    depends_on_graph: { adjacency: new Map(), topologicalOrder: [] as string[] },
  };
}

describe('validateBuilders', () => {
  it('T031: unknown builder → BRG_UNKNOWN_BUILDER with app/field/message listing available (FR-013, US-5 AC1)', () => {
    const registry = makeRegistry('nestjs-function', 'docker');
    const model = makeModel({ analytics: 'nest-function' });
    const result = validateBuilders(model, registry);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe(BRG_UNKNOWN_BUILDER);
    expect(result.errors[0]?.app).toBe('analytics');
    expect(result.errors[0]?.field).toBe('builder');
    expect(result.errors[0]?.message).toContain('nest-function');
    expect(result.errors[0]?.message).toContain('nestjs-function');
    expect(result.errors[0]?.message).toContain('docker');
  });

  it('T032: known builder → ok (FR-013, US-5 AC2)', () => {
    const registry = makeRegistry('nestjs-function', 'docker');
    const model = makeModel({ frontend: 'nestjs-function' });
    const result = validateBuilders(model, registry);
    expect(result.kind).toBe('ok');
  });

  it('T033: 2 unknown builders → 2 BRG_UNKNOWN_BUILDER diagnostics (collect-all, FR-013, US-5 AC3)', () => {
    const registry = makeRegistry('docker');
    const model = makeModel({ a: 'unknown', b: 'unknown2' });
    const result = validateBuilders(model, registry);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors.every((e) => e.code === BRG_UNKNOWN_BUILDER)).toBe(true);
    const apps = result.errors.map((e) => e.app);
    expect(apps).toContain('a');
    expect(apps).toContain('b');
  });

  it('T034: empty registry + 1 app → BRG_UNKNOWN_BUILDER with empty available list (US-6 AC2)', () => {
    const registry = makeRegistry();
    const model = makeModel({ myapp: 'some-builder' });
    const result = validateBuilders(model, registry);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.errors[0]?.code).toBe(BRG_UNKNOWN_BUILDER);
    expect(result.errors[0]?.message).toContain('available builders:');
  });

  it('T035: empty registry + 0 apps → ok', () => {
    const registry = makeRegistry();
    const model = makeModel({});
    const result = validateBuilders(model, registry);
    expect(result.kind).toBe('ok');
  });
});
