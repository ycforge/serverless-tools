import { describe, expectTypeOf, it } from 'vitest';

import type {
  Artifact,
  BuildContext,
  Builder,
} from '../../src/contracts/index.js';

// Type-level contract tests for FR-001..FR-003 (Builder / BuildContext /
// Artifact). These must break compilation if any public signature changes
// (SC-002). Type-only import — no runtime dependency on the contracts module.

declare const builder: Builder;
declare const context: BuildContext;

// FR-001: a single build invocation returns exactly one Artifact.
export function buildReturnsSingleArtifact(): Promise<Artifact> {
  return builder.build(context);
}

describe('Builder contract (FR-001..FR-003)', () => {
  it('FR-001: build(context) returns Promise<Artifact>', () => {
    expectTypeOf(builder.build).returns.toEqualTypeOf<Promise<Artifact<unknown>>>();
    expectTypeOf(builder.build(context)).toEqualTypeOf<Promise<Artifact<unknown>>>();
  });

  it('FR-002: BuildContext has exactly the specified fields (no C internals, FR-015)', () => {
    expectTypeOf<keyof BuildContext>().toEqualTypeOf<
      'projectRoot' | 'sourcePath' | 'buildConfig' | 'buildEnv' | 'outputDir'
    >();
    expectTypeOf(context.projectRoot).toEqualTypeOf<string>();
    // US1 scenario 3: sourcePath is optional; a builder without it is valid.
    expectTypeOf(context.sourcePath).toEqualTypeOf<string | undefined>();
    expectTypeOf(context.buildConfig).toEqualTypeOf<unknown>();
    expectTypeOf(context.buildEnv).toEqualTypeOf<Record<string, string>>();
    expectTypeOf(context.outputDir).toEqualTypeOf<string>();
  });

  it('FR-003: Artifact<T> is a generic { type, value } pair', () => {
    expectTypeOf<Artifact>().toEqualTypeOf<{ readonly type: string; readonly value: unknown }>();
    const typed = {} as Artifact<{ archivePath: string; entryPoint: string }>;
    expectTypeOf(typed.type).toEqualTypeOf<string>();
    expectTypeOf(typed.value).toEqualTypeOf<{ archivePath: string; entryPoint: string }>();
  });
});
