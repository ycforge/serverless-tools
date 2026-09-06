import { describe, expectTypeOf, it } from 'vitest';

import {
  BRG_DUPLICATE_KEY,
  BRG_INVALID,
  BRG_KEY_COLLISION,
  BRG_LOAD_ERROR,
  BRG_MISSING_FILE,
  BRG_NOT_A_PLUGIN,
  BRG_PACKAGE_NOT_FOUND,
  BRG_UNKNOWN_BUILDER,
  BRG_VERSION,
  type PluginEntry,
  type PluginKind,
  type PluginLoadError,
  type PluginRegistry,
  type PluginRegistryLoadResult,
  type BuilderRegistryValidationResult,
  type RegistryError,
} from '../../src/contracts/index.js';
import type { ProjectModelDiagnostic } from '../../src/contracts/project-model.js';
import type { ProjectModel } from '../../src/contracts/project-model.js';
import { loadRegistry, validateBuilders } from '../../src/index.js';

// T040: Type-level contract tests for spec 013 public contracts.
// Must break compilation on shape changes.

declare const pluginEntry: PluginEntry;
declare const pluginLoadError: PluginLoadError;
declare const registry: PluginRegistry;
declare const loadResult: PluginRegistryLoadResult;
declare const validationResult: BuilderRegistryValidationResult;
declare const registryError: RegistryError;

describe('registry public types (spec 013)', () => {
  it('PluginKind is builder | materializer', () => {
    expectTypeOf<PluginKind>().toEqualTypeOf<'builder' | 'materializer'>();
  });

  it('PluginEntry has id/packageName/kind/module', () => {
    expectTypeOf<PluginEntry['id']>().toEqualTypeOf<string>();
    expectTypeOf<PluginEntry['packageName']>().toEqualTypeOf<string>();
    expectTypeOf<PluginEntry['kind']>().toEqualTypeOf<PluginKind>();
    expectTypeOf<PluginEntry['module']>().toEqualTypeOf<unknown>();
  });

  it('PluginRegistry has frozen ReadonlyMap records', () => {
    expectTypeOf<PluginRegistry['records']>().toEqualTypeOf<ReadonlyMap<string, PluginEntry>>();
  });

  it('PluginLoadError has id/packageName/code/message', () => {
    expectTypeOf<PluginLoadError['id']>().toEqualTypeOf<string>();
    expectTypeOf<PluginLoadError['packageName']>().toEqualTypeOf<string>();
    expectTypeOf<PluginLoadError['code']>().toEqualTypeOf<string>();
    expectTypeOf<PluginLoadError['message']>().toEqualTypeOf<string>();
  });

  it('PluginRegistryLoadResult is ok | invalid discriminated union', () => {
    expectTypeOf(loadResult).toEqualTypeOf<
      | { kind: 'ok'; registry: PluginRegistry }
      | { kind: 'invalid'; errors: readonly RegistryError[] }
    >();
  });

  it('BuilderRegistryValidationResult is ok | invalid with ProjectModelDiagnostic[]', () => {
    expectTypeOf(validationResult).toEqualTypeOf<
      | { kind: 'ok' }
      | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] }
    >();
  });

  it('RegistryError is ProjectModelDiagnostic | PluginLoadError', () => {
    expectTypeOf<RegistryError>().toEqualTypeOf<ProjectModelDiagnostic | PluginLoadError>();
  });

  it('BRG_* constants are exported string literals', () => {
    expectTypeOf<typeof BRG_MISSING_FILE>().toEqualTypeOf<'BRG_MISSING_FILE'>();
    expectTypeOf<typeof BRG_VERSION>().toEqualTypeOf<'BRG_VERSION'>();
    expectTypeOf<typeof BRG_DUPLICATE_KEY>().toEqualTypeOf<'BRG_DUPLICATE_KEY'>();
    expectTypeOf<typeof BRG_KEY_COLLISION>().toEqualTypeOf<'BRG_KEY_COLLISION'>();
    expectTypeOf<typeof BRG_INVALID>().toEqualTypeOf<'BRG_INVALID'>();
    expectTypeOf<typeof BRG_PACKAGE_NOT_FOUND>().toEqualTypeOf<'BRG_PACKAGE_NOT_FOUND'>();
    expectTypeOf<typeof BRG_NOT_A_PLUGIN>().toEqualTypeOf<'BRG_NOT_A_PLUGIN'>();
    expectTypeOf<typeof BRG_LOAD_ERROR>().toEqualTypeOf<'BRG_LOAD_ERROR'>();
    expectTypeOf<typeof BRG_UNKNOWN_BUILDER>().toEqualTypeOf<'BRG_UNKNOWN_BUILDER'>();
  });

  it('loadRegistry and validateBuilders signatures', () => {
    // Verify they are importable functions with expected parameter counts
    expectTypeOf(loadRegistry).parameters.toEqualTypeOf<[string]>();
    expectTypeOf(validateBuilders).parameters.toMatchTypeOf<[ProjectModel, PluginRegistry]>();
  });
});
