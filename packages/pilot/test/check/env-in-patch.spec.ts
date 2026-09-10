import { describe, expect, it } from 'vitest';

import type { ExtensionsYaml } from '../../src/contracts/index.js';
import { scanPatchForEnvRefs } from '../../src/check/categories/env-in-patch.js';
import { YCK_ENV_IN_PATCH } from '../../src/contracts/check.js';

function makeExtensions(patches: Array<{ target: string; patch: Record<string, unknown> }>): ExtensionsYaml {
  return {
    version: 1,
    extensions: patches,
  };
}

describe('env-in-patch (T040)', () => {
  it('AC1: patch with {{$API_KEY}} → YCK_ENV_IN_PATCH with target and field', () => {
    const extensions = makeExtensions([
      {
        target: 'functions.user_service',
        patch: { environment: { API_KEY: '{{$API_KEY}}' } },
      },
    ]);
    const diagnostics = scanPatchForEnvRefs(extensions);
    const envDiags = diagnostics.filter((d) => d.code === YCK_ENV_IN_PATCH);
    expect(envDiags).toHaveLength(1);
    expect(envDiags[0]?.target).toBe('functions.user_service');
    expect(envDiags[0]?.field).toBe('environment.API_KEY');
  });

  it('AC2: plain Terraform values → 0 YCK_ENV_IN_PATCH', () => {
    const extensions = makeExtensions([
      {
        target: 'functions.user_service',
        patch: { runtime: 'python312', memory: 128 },
      },
    ]);
    const diagnostics = scanPatchForEnvRefs(extensions);
    expect(diagnostics.filter((d) => d.code === YCK_ENV_IN_PATCH)).toHaveLength(0);
  });

  it('AC3: 3 rules, 1 with {{$ENV}} at depth 2 → exactly 1 YCK_ENV_IN_PATCH', () => {
    const extensions = makeExtensions([
      {
        target: 'functions.user_service',
        patch: { runtime: 'python312' },
      },
      {
        target: 'functions.analytics',
        patch: { nested: { patch: { value: '{{$DEEP}}' } } },
      },
      {
        target: 'gateways.main',
        patch: { custom_domains: [] },
      },
    ]);
    const diagnostics = scanPatchForEnvRefs(extensions);
    const envDiags = diagnostics.filter((d) => d.code === YCK_ENV_IN_PATCH);
    expect(envDiags).toHaveLength(1);
    expect(envDiags[0]?.target).toBe('functions.analytics');
    expect(envDiags[0]?.field).toBe('nested.patch.value');
  });

  it('edge: no extensions → 0 diagnostics', () => {
    const extensions = makeExtensions([]);
    const diagnostics = scanPatchForEnvRefs(extensions);
    expect(diagnostics).toHaveLength(0);
  });

  it('multiple ENV refs in one patch → multiple diagnostics', () => {
    const extensions = makeExtensions([
      {
        target: 'functions.user_service',
        patch: { environment: { A: '{{$A}}', B: '{{$B}}' } },
      },
    ]);
    const diagnostics = scanPatchForEnvRefs(extensions);
    const envDiags = diagnostics.filter((d) => d.code === YCK_ENV_IN_PATCH);
    expect(envDiags).toHaveLength(2);
  });
});
