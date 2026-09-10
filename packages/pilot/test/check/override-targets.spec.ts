import { describe, expect, it } from 'vitest';

import type { ExtensionsYaml, TerraformResource } from '../../src/contracts/index.js';
import { checkOverrideTargets } from '../../src/check/categories/override-targets.js';
import { YCK_MISSING_TARGET } from '../../src/contracts/check.js';
import { functionResource, gatewayResource } from '../helpers/extensions-fixtures.js';

function makeGeneratedResources(...resources: TerraformResource[]): readonly TerraformResource[] {
  return resources;
}

function makeExtensions(targets: string[]): ExtensionsYaml {
  return {
    version: 1,
    extensions: targets.map((target) => ({ target, patch: {} })),
  };
}

describe('override-targets (T030)', () => {
  it('AC1: existing target → no YCK_MISSING_TARGET', () => {
    const generated = makeGeneratedResources(
      functionResource('user_service', { name: 'user-service', runtime: 'nodejs18' }),
      gatewayResource('main', { name: 'main-gw' }),
    );
    const extensions = makeExtensions(['functions.user_service']);
    const diagnostics = checkOverrideTargets(extensions, generated);
    expect(diagnostics.filter((d) => d.code === YCK_MISSING_TARGET)).toHaveLength(0);
  });

  it('AC2: missing target → YCK_MISSING_TARGET with sorted availableIdls', () => {
    const generated = makeGeneratedResources(
      functionResource('analytics', { name: 'analytics-svc', runtime: 'nodejs22' }),
    );
    const extensions = makeExtensions(['functions.user_service']);
    const diagnostics = checkOverrideTargets(extensions, generated);
    const missing = diagnostics.filter((d) => d.code === YCK_MISSING_TARGET);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.target).toBe('functions.user_service');
    expect(missing[0]?.availableIdls).toEqual(['functions.analytics']);
  });

  it('AC3: two valid targets → 0 YCK_MISSING_TARGET', () => {
    const generated = makeGeneratedResources(
      functionResource('user_service', { name: 'user-service' }),
      functionResource('analytics', { name: 'analytics-svc' }),
    );
    const extensions = makeExtensions(['functions.user_service', 'functions.analytics']);
    const diagnostics = checkOverrideTargets(extensions, generated);
    expect(diagnostics.filter((d) => d.code === YCK_MISSING_TARGET)).toHaveLength(0);
  });

  it('FR-010: empty generated model → all targets missing', () => {
    const extensions = makeExtensions(['functions.user_service', 'functions.analytics']);
    const diagnostics = checkOverrideTargets(extensions, []);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.availableIdls).toEqual([]);
    expect(diagnostics[1]?.availableIdls).toEqual([]);
  });

  it('edge: no extensions → 0 diagnostics', () => {
    const generated = makeGeneratedResources(functionResource('user_service', {}));
    const extensions = makeExtensions([]);
    const diagnostics = checkOverrideTargets(extensions, generated);
    expect(diagnostics).toHaveLength(0);
  });
});
