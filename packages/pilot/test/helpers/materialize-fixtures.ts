import type {
  ArtifactDescriptor,
  MaterializationContext,
  Materializer,
  PluginEntry,
  PluginRegistry,
  ProjectModel,
  TerraformResource,
} from '../../src/contracts/index.js';
import { loadProjectModel } from '../../src/index.js';
import { writeFixtureModule } from './registry-fixtures.js';
import { createTempProject, removeTempProject, type TempProject } from './temp-project.js';

/**
 * Materializer-dispatch test fixture helper (T002).
 *
 * Two fixture strategies (task T002, resolved):
 *  - inline plain-object materializers via {@link makeMaterializer} — for pure
 *    dispatch and most integration scenarios (spec Assumption „fixture
 *    materializers are inline plain objects"); call-recording spy built in;
 *  - mkdtemp-generated `.mjs` modules via {@link writeFixtureMaterializer}
 *    (reuses `writeFixtureModule` from the 013 helpers) — for scenarios that
 *    must run through the real `loadRegistry`;
 *  - a minimal committed set in `test/materialize/fixtures/`.
 *
 * `process.env`-switched fixtures are REJECTED (global state between
 * parallel tests); every test uses its own tmp dir / inline object.
 */

// Golden bytes shared by unit + quickstart tests (Sc1 / Sc12, quickstart.md).
export const GOLDEN_USER_SERVICE_TF_JSON = `{
  "resource": {
    "yandex_function": {
      "user_service": {
        "content": {
          "source": "dist/user_service.zip"
        },
        "name": "user_service",
        "runtime": "nodejs20"
      }
    }
  }
}`;

export const GOLDEN_OUTPUTS_TF_JSON = `{
  "output": {
    "url": {
      "description": "URL",
      "value": "\${function_url(user_service)}"
    }
  }
}`;

export const MAIN_TF_CONTENT = '# user\nresource "yandex_vpc_network" "net" {}\n';

export interface MaterializerSpy {
  /** Every artifact descriptor passed to `supports`, in call order. */
  readonly supportsCalls: ArtifactDescriptor[];
  /** Every context passed to `materialize`, in call order. */
  readonly materializeCalls: MaterializationContext[];
  readonly count: {
    readonly supports: number;
    readonly materialize: number;
  };
}

export interface MaterializerFixture {
  readonly id: string;
  readonly plugin: Materializer<ArtifactDescriptor>;
  readonly spy: MaterializerSpy;
}

export interface MakeMaterializerOptions {
  /**
   * Custom `supports` predicate. Takes precedence over `supportedTypes`.
   * May throw — a throwing `supports` MUST reject dispatch (A2).
   */
  readonly supports?: (artifact: ArtifactDescriptor) => boolean;
  /** If given, `supports` returns `type in supportedTypes`. */
  readonly supportedTypes?: readonly string[];
  /** Custom `materialize`. Defaults to a canned `yandex_function` resource. */
  readonly materialize?: (
    artifact: ArtifactDescriptor,
    context: MaterializationContext,
  ) => TerraformResource;
  /** If true, `materialize` always throws `Error(errorMessage)`. */
  readonly materializeThrows?: boolean;
  readonly errorMessage?: string;
}

function defaultResource(artifact: ArtifactDescriptor): TerraformResource {
  return {
    kind: 'resource',
    type: 'yandex_function',
    name: artifact.id,
    configuration: { name: artifact.id, runtime: 'nodejs20', content: { source: `dist/${artifact.id}.zip` } },
  };
}

export function makeMaterializer(id: string, options: MakeMaterializerOptions = {}): MaterializerFixture {
  const supportsCalls: ArtifactDescriptor[] = [];
  const materializeCalls: MaterializationContext[] = [];

  const supportsFn =
    options.supports ??
    (options.supportedTypes !== undefined
      ? (a: ArtifactDescriptor) => options.supportedTypes!.includes(a.type)
      : () => true);

  const materializeFn =
    options.materialize ??
    ((a: ArtifactDescriptor) => defaultResource(a));

  const plugin: Materializer<ArtifactDescriptor> = {
    supports(artifact, _context) {
      supportsCalls.push(artifact);
      return supportsFn(artifact);
    },
    async materialize(artifact, context) {
      materializeCalls.push(context);
      if (options.materializeThrows === true) {
        throw new Error(options.errorMessage ?? 'plugin crashed');
      }
      return materializeFn(artifact, context);
    },
  };

  const count: MaterializerSpy['count'] = {
    get supports() {
      return supportsCalls.length;
    },
    get materialize() {
      return materializeCalls.length;
    },
  };

  return { id, plugin, spy: { supportsCalls, materializeCalls, count } };
}

/** Canonical fixture: supports `nestjs-function`, returns `yandex_function`. */
export function matNest(id = 'yandex-function'): MaterializerFixture {
  return makeMaterializer(id, {
    supportedTypes: ['nestjs-function'],
  });
}

/** Canonical fixture: supports `docker`, returns `yandex_container`. */
export function matDocker(id = 'yandex-container'): MaterializerFixture {
  return makeMaterializer(id, {
    supportedTypes: ['docker'],
    materialize: (a) => ({
      kind: 'resource',
      type: 'yandex_container',
      name: a.id,
      configuration: { name: a.id, image: `registry.example.com/${a.id}` },
    }),
  });
}

/** Canonical fixture: supports `vite`, returns a canned storage bucket. */
export function matVite(id = 'vite-materializer'): MaterializerFixture {
  return makeMaterializer(id, {
    supportedTypes: ['vite'],
    materialize: (a) => ({
      kind: 'resource',
      type: 'yandex_storage_bucket',
      name: a.id,
      configuration: { name: a.id },
    }),
  });
}

/** Canonical fixture: supports the given type, `materialize` throws. */
export function matThrow(id = 'throw-materializer', supportedTypes: readonly string[] = ['vite']): MaterializerFixture {
  return makeMaterializer(id, {
    supportedTypes,
    materializeThrows: true,
  });
}

/** Canonical fixture: supports the given types and declares output `url`. */
export function matWithOutput(
  id = 'yandex-function',
  supportedTypes: readonly string[] = ['nestjs-function'],
): MaterializerFixture {
  return makeMaterializer(id, {
    supportedTypes,
    materialize: (a, ctx) => {
      ctx.output.declare('url', { value: `function_url(${a.id})`, description: 'URL' });
      return { kind: 'resource', type: 'yandex_function', name: a.id, configuration: { name: a.id } };
    },
  });
}

/** Not a materializer — `{ foo }` (registry shape-detection rejects it). */
export function notAMaterializer(): unknown {
  return { foo: () => {} };
}

/** Wrap an inline materializer as a registry entry (kind 'materializer'). */
export function materializerEntry(fx: MaterializerFixture): PluginEntry {
  return { id: fx.id, packageName: `inline:${fx.id}`, kind: 'materializer', module: fx.plugin };
}

/** Build a registry with insertion-order-preserving records. */
export function makeRegistry(entries: readonly PluginEntry[]): PluginRegistry {
  const records = new Map<string, PluginEntry>();
  for (const entry of entries) {
    records.set(entry.id, entry);
  }
  return { records: Object.freeze(records) as ReadonlyMap<string, PluginEntry> };
}

/**
 * Generate an `.mjs` materializer module in `dir` (for scenarios running
 * through the real `loadRegistry`). Reuses `writeFixtureModule` (013 helpers).
 * `supports`/`materialize` are arrow-function bodies.
 */
export function writeFixtureMaterializer(
  dir: string,
  name: string,
  body: { readonly supports?: string; readonly materialize?: string } = {},
): string {
  const supports = body.supports ?? '() => true';
  const materialize =
    body.materialize ??
    `(a, ctx) => ({ kind: 'resource', type: 'yandex_function', name: a.id, configuration: {} })`;
  const code = `export default {\n  supports: ${supports},\n  materialize: async ${materialize},\n};\n`;
  return writeFixtureModule(dir, `${name}.mjs`, code);
}

/** Canonical `apps.yaml` from quickstart.md (user_service/analytics/frontend/openapi). */
export function canonicalAppsYaml(): string {
  return `version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
  analytics:    { source_path: analytics,    builder: docker }
  frontend:     { source_path: frontend,     builder: vite,        depends_on: [user_service] }
  openapi:      { source_path: openapi,      builder: yandex-api-gateway, depends_on: [user_service] }
`;
}

export function loadModel(project: TempProject): ProjectModel {
  const result = loadProjectModel(project.root);
  if (result.kind !== 'ok') {
    throw new Error(`loadProjectModel expected ok, got invalid: ${result.errors.length} errors`);
  }
  return result.model;
}

/** Build a ProjectModel from a bare `apps.yaml` string (hermetic, cleaned up). */
export function appsModel(appsYaml: string): ProjectModel {
  const project = createTempProject({ '.ycsf/apps.yaml': appsYaml });
  try {
    return loadModel(project);
  } finally {
    removeTempProject(project);
  }
}