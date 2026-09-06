import { describe, expectTypeOf, it } from 'vitest';

import {
  isEnvRef,
  isVersion,
  PML_DEPENDS_CYCLE,
  PML_ENV_NOT_SET,
  PML_IDENTITY_COLLISION,
  PML_VERSION,
} from '../../src/contracts/index.js';
import type {
  App,
  BuildConfig,
  DependsOnGraph,
  EnvRequirement,
  ProjectModel,
  ProjectModelDiagnostic,
  ProjectModelError,
  ProjectModelLoadResult,
  Resource,
} from '../../src/contracts/index.js';

// Type-level contract tests for the spec 011 project-model public surface
// (contracts/project-model.json). Must break compilation on shape changes so
// downstream specs (013 builder-registry, 021 CLI) get a stable type contract.
//
// Note: PML_* constants are asserted via `expectTypeOf<typeof X>()` rather
// than `expectTypeOf(X)` — TS inference widens an imported const reference
// passed by value, but the generic form keeps the literal type.

declare const app: App;
declare const resource: Resource;
declare const buildConfig: BuildConfig;
declare const envRequirement: EnvRequirement;
declare const graph: DependsOnGraph;
declare const model: ProjectModel;
declare const loadResult: ProjectModelLoadResult;

describe('project-model public types (spec 011)', () => {
  it('App has stable shape: app_id/source_path/builder/depends_on', () => {
    expectTypeOf<App['app_id']>().toEqualTypeOf<string>();
    expectTypeOf<App['source_path']>().toEqualTypeOf<string>();
    expectTypeOf<App['builder']>().toEqualTypeOf<string>();
    expectTypeOf<App['depends_on']>().toEqualTypeOf<string[]>();
  });

  it('Resource is domain/resource_id/properties', () => {
    expectTypeOf<Resource['domain']>().toEqualTypeOf<string>();
    expectTypeOf<Resource['resource_id']>().toEqualTypeOf<string>();
    expectTypeOf<Resource['properties']>().toEqualTypeOf<Record<string, unknown>>();
  });

  it('BuildConfig carries opaque build_config + build_env maps', () => {
    expectTypeOf<BuildConfig['build_config']>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<BuildConfig['build_env']>().toEqualTypeOf<Record<string, string | null>>();
  });

  it('EnvRequirement is name/source/app_id/isSet', () => {
    expectTypeOf<EnvRequirement['name']>().toEqualTypeOf<string>();
    expectTypeOf<EnvRequirement['source']>().toEqualTypeOf<'build_config' | 'build_env'>();
    expectTypeOf<EnvRequirement['isSet']>().toEqualTypeOf<boolean>();
  });

  it('DependsOnGraph has adjacency + topologicalOrder', () => {
    expectTypeOf<DependsOnGraph['adjacency']>().toEqualTypeOf<
      ReadonlyMap<string, readonly string[]>
    >();
    expectTypeOf<DependsOnGraph['topologicalOrder']>().toEqualTypeOf<readonly string[]>();
  });

  it('ProjectModel aggregates apps/resources/build_configs/env_requirements/graph', () => {
    expectTypeOf<ProjectModel['apps']>().toEqualTypeOf<ReadonlyMap<string, App>>();
    expectTypeOf<ProjectModel['resources']>().toEqualTypeOf<
      ReadonlyMap<string, ReadonlyMap<string, Resource>>
    >();
    expectTypeOf<ProjectModel['build_configs']>().toEqualTypeOf<
      ReadonlyMap<string, BuildConfig>
    >();
    expectTypeOf<ProjectModel['env_requirements']>().toEqualTypeOf<
      ReadonlyMap<string, EnvRequirement>
    >();
    expectTypeOf<ProjectModel['depends_on_graph']>().toEqualTypeOf<DependsOnGraph>();
  });

  it('ProjectModelLoadResult is never a thrown error: ok | invalid', () => {
    expectTypeOf(loadResult).toEqualTypeOf<
      | { kind: 'ok'; model: ProjectModel }
      | { kind: 'invalid'; errors: readonly ProjectModelError[] }
    >();
  });

  it('ProjectModelDiagnostic carries code/message/file + optional FR-015 fields', () => {
    expectTypeOf<ProjectModelDiagnostic['code']>().toEqualTypeOf<string>();
    expectTypeOf<ProjectModelDiagnostic['message']>().toEqualTypeOf<string>();
    expectTypeOf<ProjectModelDiagnostic['file']>().toEqualTypeOf<string>();
    expectTypeOf<ProjectModelDiagnostic['app']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ProjectModelDiagnostic['identity']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ProjectModelDiagnostic['field']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ProjectModelDiagnostic['line']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<ProjectModelDiagnostic['column']>().toEqualTypeOf<number | undefined>();
  });

  it('ProjectModelError aggregates diagnostics + carries code', () => {
    expectTypeOf<ProjectModelError['diagnostics']>().toEqualTypeOf<
      readonly ProjectModelDiagnostic[]
    >();
    expectTypeOf<ProjectModelError['code']>().toEqualTypeOf<string>();
  });

  it('PML_* codes are exported string constants, never literals in consumer code', () => {
    expectTypeOf<typeof PML_VERSION>().toEqualTypeOf<'PML_VERSION'>();
    expectTypeOf<typeof PML_ENV_NOT_SET>().toEqualTypeOf<'PML_ENV_NOT_SET'>();
    expectTypeOf<typeof PML_IDENTITY_COLLISION>().toEqualTypeOf<'PML_IDENTITY_COLLISION'>();
    expectTypeOf<typeof PML_DEPENDS_CYCLE>().toEqualTypeOf<'PML_DEPENDS_CYCLE'>();
  });

  it('predicates are pure and narrow types', () => {
    expectTypeOf(isEnvRef).returns.toEqualTypeOf<boolean>();
    expectTypeOf(isVersion).returns.toEqualTypeOf<boolean>();
    // isVersion is a type guard to literal 1:
    const accept: (v: 1) => void = () => {};
    let version: number = 0;
    if (isVersion(version)) {
      accept(version);
    }
    // isEnvRef narrows the string to a string (pure predicate):
    let maybe: string = '{{$X}}';
    if (isEnvRef(maybe)) {
      acceptVersionRef(maybe);
    }
  });
});

function acceptVersionRef(_ref: string): void {
  return;
}