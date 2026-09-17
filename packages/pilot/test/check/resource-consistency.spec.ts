import { describe, expect, it } from 'vitest';

import type { ProjectModel, TerraformResource } from '../../src/contracts/index.js';
import { checkResourceConsistency } from '../../src/check/categories/resource-consistency.js';
import { YCK_REF_UNRESOLVED } from '../../src/contracts/check.js';

function makeProjectModel(resources: Map<string, Map<string, { domain: string; resource_id: string; properties: Record<string, unknown> }>>): ProjectModel {
  return {
    apps: new Map(),
    resources,
    build_configs: new Map(),
    env_requirements: new Map(),
    depends_on_graph: { adjacency: new Map(), topologicalOrder: [] },
  };
}

function makeGeneratedResources(...resources: TerraformResource[]): readonly TerraformResource[] {
  return resources;
}

describe('resource-consistency (T060)', () => {
  it('AC1: matching generated resource → 0 YCK_REF_UNRESOLVED', () => {
    const resources = new Map([
      ['functions', new Map([['external_svc', { domain: 'functions', resource_id: 'external_svc', properties: {} }]])],
    ]);
    const model = makeProjectModel(resources);
    const generated = makeGeneratedResources({
      kind: 'resource',
      type: 'yandex_function',
      name: 'external_svc',
      configuration: {},
    });
    const diagnostics = checkResourceConsistency(model, generated);
    expect(diagnostics.filter((d) => d.code === YCK_REF_UNRESOLVED)).toHaveLength(0);
  });

  it('AC2: missing generated resource → YCK_REF_UNRESOLVED with resourceRef and file', () => {
    const resources = new Map([
      ['functions', new Map([['external_svc', { domain: 'functions', resource_id: 'external_svc', properties: {} }]])],
    ]);
    const model = makeProjectModel(resources);
    const generated = makeGeneratedResources({
      kind: 'resource',
      type: 'yandex_function',
      name: 'user_service',
      configuration: {},
    });
    const diagnostics = checkResourceConsistency(model, generated);
    const unresolved = diagnostics.filter((d) => d.code === YCK_REF_UNRESOLVED);
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0]?.resourceRef).toBe('functions.external_svc');
    expect(unresolved[0]?.file).toBe('.ycsf/resources.yaml');
  });

  it('AC3: empty resources → 0 diagnostics', () => {
    const model = makeProjectModel(new Map());
    const generated = makeGeneratedResources({
      kind: 'resource',
      type: 'yandex_function',
      name: 'user_service',
      configuration: {},
    });
    const diagnostics = checkResourceConsistency(model, generated);
    expect(diagnostics).toHaveLength(0);
  });

  it('edge: resources.yaml undefined → 0 diagnostics (skip)', () => {
    const model = makeProjectModel(new Map());
    const diagnostics = checkResourceConsistency(model, []);
    expect(diagnostics).toHaveLength(0);
  });
});
