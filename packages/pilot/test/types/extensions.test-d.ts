import { describe, expectTypeOf, it } from 'vitest';

import type {
  ApplyExtensionsResult,
  ExtensionRule,
  ExtensionsDiagnostic,
  ExtensionsLoadResult,
  ExtensionsYaml,
  ProjectModelDiagnostic,
  TerraformResource,
} from '../../src/contracts/index.js';
import {
  EXT_DUPLICATE_TARGET,
  EXT_INVALID,
  EXT_MISSING_FILE,
  EXT_UNRESOLVED_TARGET,
  EXT_VERSION,
} from '../../src/contracts/index.js';
import { applyExtensions, deepMerge, loadExtensions } from '../../src/index.js';

// T027: extensions.test-d.ts — public extensions API type contract
// (data-model.md, quickstart.md prerequisites). Must break compilation on
// signature changes. Mirrors `materialize.test-d.ts`.

declare const resources: readonly TerraformResource[];
declare const yaml: ExtensionsYaml;

describe('extensions public contracts (T027)', () => {
  it('ExtensionRule is {target, patch}', () => {
    expectTypeOf<ExtensionRule>().toMatchTypeOf<{
      target: string;
      patch: Record<string, unknown>;
    }>();
  });

  it('ExtensionsYaml is {version: 1, extensions}', () => {
    expectTypeOf<ExtensionsYaml>().toMatchTypeOf<{
      version: 1;
      extensions: readonly ExtensionRule[];
    }>();
  });

  it('ExtensionsDiagnostic carries code/message + optional target/file/field/line/column/availableIdls', () => {
    expectTypeOf<ExtensionsDiagnostic['code']>().toEqualTypeOf<string>();
    expectTypeOf<ExtensionsDiagnostic['message']>().toEqualTypeOf<string>();
    expectTypeOf<ExtensionsDiagnostic['target']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ExtensionsDiagnostic['file']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ExtensionsDiagnostic['field']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ExtensionsDiagnostic['line']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ExtensionsDiagnostic['column']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ExtensionsDiagnostic['availableIdls']>().toEqualTypeOf<
      readonly string[] | undefined
    >();
  });

  it('ApplyExtensionsResult is a discriminated ok/invalid union', () => {
    expectTypeOf<ApplyExtensionsResult>().toMatchTypeOf<
      | { kind: 'ok'; resources: readonly TerraformResource[] }
      | { kind: 'invalid'; errors: readonly ExtensionsDiagnostic[] }
    >();
  });

  it('ExtensionsLoadResult reuses the ProjectModelDiagnostic shape (011)', () => {
    expectTypeOf<ExtensionsLoadResult>().toMatchTypeOf<
      | { kind: 'ok'; data: ExtensionsYaml }
      | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] }
    >();
  });

  it('EXT_* constants are literal single-codes (Constitution V — no string coercion)', () => {
    expectTypeOf(EXT_MISSING_FILE).toEqualTypeOf<'EXT_MISSING_FILE'>();
    expectTypeOf(EXT_VERSION).toEqualTypeOf<'EXT_VERSION'>();
    expectTypeOf(EXT_INVALID).toEqualTypeOf<'EXT_INVALID'>();
    expectTypeOf(EXT_UNRESOLVED_TARGET).toEqualTypeOf<'EXT_UNRESOLVED_TARGET'>();
    expectTypeOf(EXT_DUPLICATE_TARGET).toEqualTypeOf<'EXT_DUPLICATE_TARGET'>();
  });

  it('applyExtensions(resources, extensions) exactly 2 args; loadExtensions sync', () => {
    expectTypeOf(applyExtensions).toBeCallableWith(resources, yaml);
    expectTypeOf(applyExtensions).returns.toEqualTypeOf<ApplyExtensionsResult>();
    expectTypeOf(loadExtensions).toBeCallableWith('root');
    expectTypeOf(loadExtensions).returns.toEqualTypeOf<ExtensionsLoadResult>();
    expectTypeOf(deepMerge).toBeCallableWith({}, {});
  });
});