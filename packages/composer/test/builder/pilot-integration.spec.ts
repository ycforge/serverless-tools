import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { chdir, cwd } from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildApps, dispatch } from '@ycforge/pilot';

// Real end-to-end over the Project C pipeline (spec 026, P4 / T041-T044):
// loadProjectModel → loadRegistry(absolute dist path) → buildApps → dispatch
// with the REAL @ycforge/materializers-core yandex-api-gateway. No composer
// CLI is ever involved (US-1 AC3 / SC-001) and no pilot/materializers-core
// sources are modified (NG-3/NG-5).

const COMPOSER_DIR = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/builder-openapi', import.meta.url));
const BUILDER_ENTRY = join(COMPOSER_DIR, 'dist', 'builder', 'index.js');
const CLI_DIR = join(COMPOSER_DIR, 'dist', 'cli');
// real core materializer (spec 019) for the dispatch hand-off (T043/SC-002)
const GATEWAY_MATERIALIZER_ENTRY = join(resolve(COMPOSER_DIR, '..'), 'materializers-core', 'dist', 'yandex-api-gateway', 'index.js');

interface TempProject {
  readonly root: string;
}

function createTempProject(): TempProject {
  const root = mkdtempSync(join(tmpdir(), 'ycsf-pilot-builder-'));
  cpSync(FIXTURE_DIR, root, { recursive: true });
  // pilot project-model reads `<appId>/build_config.yaml` at the root
  mkdirSync(join(root, 'openapi'), { recursive: true });
  writeFileSync(
    join(root, 'openapi', 'build_config.yaml'),
    readFileSync(join(FIXTURE_DIR, 'apps', 'openapi', 'build_config.yaml'), 'utf8'),
  );
  // registry maps the artifact type to the REAL built dist entry (risk #2:
  // in-workspace `@ycforge/composer/builder` cannot be imported by a dynamic
  // import from pilot, so the fixture pins the absolute dist path).
  writeFileSync(
    join(root, '.ycsf', 'builders.yaml'),
    `version: 1
builders:
  "ycforge:api-gateway": "${BUILDER_ENTRY}"
materializers:
  yandex-api-gateway: "${GATEWAY_MATERIALIZER_ENTRY}"
`,
  );
  return { root };
}

function removeTempProject(project: TempProject): void {
  rmSync(project.root, { recursive: true, force: true });
}

async function expectOkBuild(
  project: TempProject,
  progress: string[] = [],
): Promise<Awaited<ReturnType<typeof buildApps>> & { kind: 'ok' }> {
  const result = await buildApps(project.root, { noCache: true, onAppProgress: (id) => progress.push(id) });
  expect(result.kind).toBe('ok');
  if (result.kind !== 'ok') return result as never;
  return result;
}

describe('pilot integration (spec 026, P4 / T041-T044): real builder via buildApps + dispatch', () => {
  let project: TempProject;

  beforeEach(() => {
    project = createTempProject();
  });

  afterEach(() => {
    removeTempProject(project);
  });

  it('T042: buildApps dispatches the REAL ycforge:api-gateway builder, once, in-process (US-1/SC-001)', async () => {
    expect(existsSync(BUILDER_ENTRY)).toBe(true);
    const progress: string[] = [];
    const result = await expectOkBuild(project, progress);

    // build() executed exactly once, for the single map-form app
    expect(progress).toEqual(['openapi']);
    expect(result.artifacts).toHaveLength(1);
    const { appId, artifact } = result.artifacts[0]!;
    expect(appId).toBe('openapi');
    expect(artifact.type).toBe('ycforge:api-gateway');

    const value = artifact.value as { specPath?: string; resourceReferences?: unknown };
    expect(typeof value.specPath).toBe('string');
    expect(isAbsolute(value.specPath!)).toBe(true);
    expect(relative(project.root, value.specPath!)).toBe(join('.ycsf', 'artifacts', 'openapi', 'openapi.json'));

    // the artifact file exists and parses as an OpenAPI document
    expect(existsSync(value.specPath!)).toBe(true);
    const document = JSON.parse(readFileSync(value.specPath!, 'utf8'));
    expect(document.openapi).toBeDefined();
    expect(document.paths).toBeDefined();
    expect(document.paths['/v1/hello']).toBeDefined();

    // the value is JSON-serializable — valid for the pilot blob cache (spec 022)
    const roundTripped = JSON.parse(JSON.stringify(value));
    expect(roundTripped).toEqual(value);
  });

  it('T043: dispatch + REAL @ycforge/materializers-core yandex-api-gateway hand-off (US-3/SC-002, NG-3)', async () => {
    const result = await expectOkBuild(project);
    const artifacts = new Map(result.artifacts.map(({ appId, artifact }) => [appId, artifact]));

    // fresh temp cwd — NG-3: the core materializer writes its companion file
    // relative to process.cwd(); we honor it (no materializers-core fixes, NG-5)
    const materializeCwd = mkdtempSync(join(tmpdir(), 'ycsf-gateway-cwd-'));
    const previousCwd = cwd();
    try {
      chdir(materializeCwd);
      const dispatchResult = await dispatch(result.projectModel, result.registry, { artifacts });
      expect(dispatchResult.kind).toBe('ok');
      if (dispatchResult.kind !== 'ok') return;

      const file = dispatchResult.generatedFiles.find((f) => f.filename === 'openapi.ycsf.tf.json');
      expect(file).toBeDefined();
      const tfJson = JSON.parse(file!.content) as {
        resource: { yandex_api_gateway: Record<string, { spec: string }> };
      };
      const gateway = tfJson.resource.yandex_api_gateway.openapi!;
      expect(gateway).toBeDefined();
      // name = artifact.name = appId ('openapi'); TF address stamped by C-dispatch
      expect(gateway.spec).toBe('file("${path.module}/generated/openapi-openapi.yaml")');

      // NG-3 companion file landed under the temp cwd with the resources refs
      // rewritten to real Terraform references (FR-014 / SC-002)
      const companion = readFileSync(join(materializeCwd, 'generated', 'openapi-openapi.yaml'), 'utf8');
      expect(companion).toContain('${yandex_function.user_service.id}');
      expect(companion).not.toContain('${resources.functions.user_service.id}');
    } finally {
      chdir(previousCwd);
      rmSync(materializeCwd, { recursive: true, force: true });
    }
  });

  it('T044: composition happens in-process — no composer CLI subprocess (US-1 AC3, SC-001)', async () => {
    // Prove no `ycsf-api` CLI is ever shelled out to: hide the built CLI
    // during the build. If the pipeline resorted to `node dist/cli/index.js`,
    // the spawn would fail (ENOENT) and the build would reject.
    expect(existsSync(CLI_DIR)).toBe(true);
    const hidden = `${CLI_DIR}.probe-hidden`;
    renameSync(CLI_DIR, hidden);
    try {
      const progress: string[] = [];
      const result = await expectOkBuild(project, progress);
      expect(progress).toEqual(['openapi']);
      // the in-process builder still produces the artifact
      const { artifact } = result.artifacts[0]!;
      expect(artifact.type).toBe('ycforge:api-gateway');
      expect(existsSync((artifact.value as { specPath: string }).specPath)).toBe(true);
    } finally {
      renameSync(hidden, CLI_DIR);
    }
  });
});