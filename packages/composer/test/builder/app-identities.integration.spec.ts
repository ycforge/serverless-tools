import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AppIdentity, BuildContext } from '@ycforge/pilot/contracts';

import { ARTIFACT_TYPE } from '../../src/builder/artifact.js';
import builder from '../../src/builder/index.js';

// spec 028 / plan D-1, T010: a map-form project (ycforge:* builder keys,
// explicit resource identity per app) compiles openapi with NO
// .ycsf/resources.yaml — the identities come from Project C via the
// BuildContext, are merged into the resource index, and are referenced from
// the gateway artifact in all three identity domains (functions/containers/
// buckets).

const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/builder-map-form', import.meta.url));

interface TempProject {
  readonly root: string;
}

function createTempProject(): TempProject {
  const root = mkdtempSync(join(tmpdir(), 'ycsf-composer-map-form-'));
  cpSync(FIXTURE_DIR, root, { recursive: true });
  return { root };
}

function removeTempProject(project: TempProject): void {
  rmSync(project.root, { recursive: true, force: true });
}

const APP_IDENTITIES: readonly AppIdentity[] = [
  { appId: 'user_service', artifactType: 'ycforge:function' },
  { appId: 'analytics', artifactType: 'ycforge:docker-image' },
  { appId: 'frontend', artifactType: 'ycforge:frontend' },
];

describe('builder app-identities integration (spec 028, T010)', () => {
  let project: TempProject;

  beforeEach(() => {
    project = createTempProject();
  });

  afterEach(() => {
    removeTempProject(project);
  });

  it('T010: no resources.yaml — app identities resolve (0 RESOURCE_REF_*) and collect the full resourceReferences set', async () => {
    const context: BuildContext = {
      projectRoot: project.root,
      sourcePath: 'apps/openapi',
      buildConfig: { openapi_entry: 'openapi.json' },
      buildEnv: {},
      outputDir: join(project.root, '.ycsf', 'artifacts', 'openapi'),
      appIdentities: APP_IDENTITIES,
    };

    const artifact = await builder.build(context);
    expect(artifact.type).toBe(ARTIFACT_TYPE);

    const value = artifact.value as { specPath?: string; resourceReferences?: unknown };
    expect(typeof value.specPath).toBe('string');
    expect(isAbsolute(value.specPath!)).toBe(true);
    expect(relative(project.root, value.specPath!)).toBe(join('.ycsf', 'artifacts', 'openapi', 'openapi.json'));

    const document = JSON.parse(readFileSync(value.specPath!, 'utf8')) as {
      components: {
        securitySchemes: Record<string, Record<string, Record<string, string>>>;
      };
      paths: Record<string, Record<string, Record<string, Record<string, Record<string, string>>>>>;
    };

    // canonical ref form is preserved (FR-014 — the composer never rewrites them)
    expect(
      document.components.securitySchemes.authorizer!['x-yc-apigateway-authorizer']!.function_id,
    ).toBe('${resources.functions.user_service.id}');
    expect(
      document.paths['/v1/analytics']!.get!['x-yc-apigateway-integration']!['serverless-containers']!
        .container_id,
    ).toBe('${resources.containers.analytics.id}');
    expect(
      document.paths['/v1/assets']!.get!['x-yc-apigateway-integration']!['object-storage']!.bucket,
    ).toBe('${resources.buckets.frontend.name}');

    // IDT table (D-4/D-7): deduplicated by logical ref, ordered by the
    // RESOURCE_DOMAINS rank then name — functions → buckets → containers.
    expect(value.resourceReferences).toEqual([
      { logical: 'functions.user_service', terraformType: 'yandex_function' },
      { logical: 'buckets.frontend', terraformType: 'yandex_storage_bucket' },
      { logical: 'containers.analytics', terraformType: 'yandex_serverless_container' },
    ]);
  });
});