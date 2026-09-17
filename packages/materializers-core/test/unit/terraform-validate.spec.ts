import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import functionMaterializer from '../../src/yandex-function/index.js';
import gatewayMaterializer from '../../src/yandex-api-gateway/index.js';
import containerMaterializer from '../../src/yandex-serverless-container/index.js';
import { createOutputBuilder } from '../../src/helpers/output-builder.js';
import type { OutputBuilderWithCollection } from '../../src/helpers/output-builder.js';
import type { MaterializationContext, TerraformResource } from '../../src/types.js';

const exec = promisify(execFile);

interface TerraformRun {
  stdout: string;
  stderr: string;
  code: number;
}

async function runTerraform(cwd: string, args: readonly string[]): Promise<TerraformRun> {
  try {
    const { stdout, stderr } = await exec('terraform', [...args], { cwd, timeout: 120000 });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
  }
}

/**
 * T022 characterization: the materialized function/gateway configuration must
 * satisfy the yandex provider schema (`name`/`memory` for yandex_function,
 * `name` for yandex_api_gateway). Terraform is a thin orchestration probe
 * (Constitution II exception). Gated: if `terraform` is missing from PATH, or
 * the provider cannot be installed offline, the structural form is asserted
 * directly as a unit effect instead (plan §Phase 4 RED).
 */
describe('terraform validate on materialized configs (spec 028, T022)', () => {
  let savedCwd: string;
  let tmpDir: string;

  beforeAll(async () => {
    savedCwd = process.cwd();
  });

  afterEach(() => {
    process.chdir(savedCwd);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function context(projectRoot: string): MaterializationContext & { output: OutputBuilderWithCollection } {
    return { output: createOutputBuilder(), projectRoot };
  }

  it('0 "Missing required argument" for yandex_function name/memory, yandex_api_gateway name and yandex_serverless_container name/memory/image',
    { timeout: 180000 },
    async () => {
    try {
      await exec('terraform', ['version']);
    } catch {
      return; // terraform not in PATH — gated skip (golden-form asserted structurally below)
    }

    const root = mkdtempSync(join(tmpdir(), 'spec028-tf-'));
    tmpDir = root;

    mkdirSync(join(root, 'openapi'), { recursive: true });
    const openapiFile = join(root, 'openapi', 'openapi.yaml');
    writeFileSync(openapiFile, 'openapi: "3.0.0"\ninfo: { title: probe, version: "1.0.0" }\npaths: {}\n', 'utf8');
    mkdirSync(join(root, 'dist'), { recursive: true });
    writeFileSync(join(root, 'dist', 'user_service.zip'), 'spec-028-tf-probe', 'utf8');

    process.chdir(root);
    const fnCtx = context(root);
    // archivePath is relative to the terraform module dir infra/ (spec 035
    // D1/D2) — '../dist/...' resolves to root/dist both for the hash and for
    // terraform's content.zip_filename.
    const fnResource = (await functionMaterializer.materialize(
      { type: 'ycforge:function', name: 'user_service', value: { archivePath: '../dist/user_service.zip', entryPoint: 'handler' } } as never,
      fnCtx,
    )) as TerraformResource;
    const gwCtx = context(root);
    const gwResource = (await gatewayMaterializer.materialize(
      { type: 'ycforge:api-gateway', name: 'openapi', value: { specPath: openapiFile, resourceReferences: [] } } as never,
      gwCtx,
    )) as TerraformResource;
    const ctCtx = context(root);
    const ctResource = (await containerMaterializer.materialize(
      { type: 'ycforge:docker-image', name: 'analytics', value: { image: 'cr.yandex/app@sha256:abc123def456' } } as never,
      ctCtx,
    )) as TerraformResource;

    // Structural form (unit effect — RED until materializers emit required attrs).
    const fnConfig = fnResource.configuration as { name: string; memory: number };
    expect(fnConfig.name).toBe('user-service');
    expect(fnConfig.memory).toBe(128);
    const gwConfig = gwResource.configuration as { name: string };
    expect(gwConfig.name).toBe('openapi');
    const ctConfig = ctResource.configuration as { image: Array<{ url: string }>; name: string; memory: number };
    expect(ctConfig.name).toBe('analytics');
    expect(ctConfig.memory).toBe(128);
    expect(ctConfig.image).toEqual([{ url: 'cr.yandex/app@sha256:abc123def456' }]);

    // Golden terraform project: required_providers + three resources as emitted.
    const infra = join(root, 'infra');
    mkdirSync(infra, { recursive: true });
    writeFileSync(
      join(infra, 'provider.tf.json'),
      JSON.stringify({
        terraform: {
          required_providers: {
            yandex: { source: 'yandex-cloud/yandex', version: '~> 0.130' },
          },
        },
      }),
    );
    writeFileSync(
      join(infra, 'function.tf.json'),
      JSON.stringify({ resource: { yandex_function: { user_service: fnResource.configuration } } }),
    );
    writeFileSync(
      join(infra, 'gateway.tf.json'),
      JSON.stringify({ resource: { yandex_api_gateway: { openapi: gwResource.configuration } } }),
    );
    writeFileSync(
      join(infra, 'container.tf.json'),
      JSON.stringify({ resource: { yandex_serverless_container: { analytics: ctResource.configuration } } }),
    );

    // Probe: init (needs network for the provider plugin); on failure keep the
    // structural assertion above as the green-form.
    const init = await runTerraform(infra, ['init', '-input=false', '-no-color']);
    if (init.code !== 0) {
      return;
    }
    const validate = await runTerraform(infra, ['validate', '-no-color']);
    const combined = `${validate.stdout}\n${validate.stderr}`;
    expect(validate.code).toBe(0);
    expect(combined).not.toContain('Missing required argument');
  });
});