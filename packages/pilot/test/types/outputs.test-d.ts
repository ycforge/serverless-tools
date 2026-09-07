import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  type BuildOutputsInput,
  type BuildOutputsResult,
  OUT_DUPLICATE_NAME,
  OUT_INVALID,
  OUT_INVALID_AUTO_PREFIX,
  OUT_INVALID_VALUE,
  type OutputValue,
  type OutputsDiagnostic,
  type OutputsLoadResult,
  type OutputsYaml,
  OUT_MISSING_FILE,
  OUT_RESERVED_PREFIX,
  OUT_UNRESOLVED_IDL,
  OUT_VERSION,
} from '../../src/contracts/index.js';
import { buildOutputs, loadOutputs } from '../../src/index.js';

// T030: contract surface — types are exported through the subpath/root and the
// root entry exposes the feature entry points (US-5, FR-001/002/003/004/005/006,
// quickstart Sc1).

describe('outputs contract types (T030)', () => {
  it('all 8 OUT_* diagnostics exist and are unique', () => {
    const codes = [
      OUT_DUPLICATE_NAME,
      OUT_INVALID,
      OUT_INVALID_AUTO_PREFIX,
      OUT_INVALID_VALUE,
      OUT_MISSING_FILE,
      OUT_RESERVED_PREFIX,
      OUT_UNRESOLVED_IDL,
      OUT_VERSION,
    ];
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    expect(codes.every((c) => typeof c === 'string')).toBe(true);
  });

  it('OutputsYaml is { version: 1; outputs: Record<string, OutputValue> }', () => {
    expectTypeOf<OutputsYaml>().toMatchTypeOf<{
      readonly version: 1;
      readonly outputs: Record<string, OutputValue>;
    }>();
    expectTypeOf<OutputValue>().toMatchTypeOf<{ readonly value: string }>();
    expectTypeOf<OutputValue>().toMatchTypeOf<{ readonly description?: string }>();
  });

  it('OutputsDiagnostic is a diagnostic without app/target-specific fields', () => {
    expectTypeOf<OutputsDiagnostic>().toMatchTypeOf<{
      readonly code: string;
      readonly message: string;
    }>();
    expectTypeOf<OutputsDiagnostic>().not.toHaveProperty('app');
    expectTypeOf<OutputsDiagnostic>().not.toHaveProperty('target');
  });

  it('loadOutputs/buildOutputs are callable through src/index', () => {
    const loadInput: unknown = undefined;
    expectTypeOf(loadOutputs).toMatchTypeOf<(root: string) => OutputsLoadResult>();
    expectTypeOf(buildOutputs).toMatchTypeOf<
      (input: BuildOutputsInput) => BuildOutputsResult
    >();
    expectTypeOf(loadInput).not.toMatchTypeOf<Promise<unknown>>();
  });
});