import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import materializer from '../../src/yandex-api-gateway/index.js';
import { YMT_INVALID_ARTIFACT_VALUE } from '../../src/diagnostics.js';
import { createOutputBuilder } from '../../src/helpers/output-builder.js';
import type { OutputBuilderWithCollection } from '../../src/helpers/output-builder.js';
import type { MaterializationContext, TerraformResource } from '../../src/types.js';
import { makeSpecContent, makeSpecFile } from '../helpers/fixtures.js';

function createContext(): MaterializationContext & { output: OutputBuilderWithCollection } {
  return { output: createOutputBuilder() };
}

describe('yandex-api-gateway materializer (US3, T081)', () => {
  let savedCwd: string;
  let tmpDir: string;

  afterEach(() => {
    process.chdir(savedCwd);
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it('supports ycforge:api-gateway and rejects others (FR-014)', () => {
    savedCwd = process.cwd();
    const ctx = createContext();
    expect(materializer.supports({ type: 'ycforge:api-gateway', value: { specPath: 'x', resourceReferences: [] } } as never, ctx)).toBe(true);
    expect(materializer.supports({ type: 'ycforge:queue', value: {} } as never, ctx)).toBe(false);
  });

  it('writes companion with replaced refs + generates TF resource (AC1, FR-015/016)', async () => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'apigw-'));
    process.chdir(tmpDir);

    const specPath = makeSpecFile(makeSpecContent());
    const refs = [{ logical: 'functions.user_service', terraformType: 'yandex_function' }];
    const ctx = createContext();

    const result = (await materializer.materialize(
      { type: 'ycforge:api-gateway', name: 'openapi', value: { specPath, resourceReferences: refs } } as never,
      ctx,
    )) as TerraformResource;

    expect(result.kind).toBe('resource');
    expect(result.type).toBe('yandex_api_gateway');
    expect(result.name).toBe('openapi');
    expect(result.configuration).toEqual({
      spec: 'file("${path.module}/generated/openapi-openapi.yaml")',
    });

    const companionPath = join(tmpDir, 'generated', 'openapi-openapi.yaml');
    const content = readFileSync(companionPath, 'utf8');
    expect(content).toContain('${yandex_function.user_service.id}');
    expect(content).not.toContain('${resources.functions.user_service.id}');
  });

  it('empty resourceReferences copies spec as-is (AC2, FR-017)', async () => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'apigw-'));
    process.chdir(tmpDir);

    const specContent = 'openapi: "3.0.0"\ninfo:\n  title: test\npaths: {}\n';
    const specPath = makeSpecFile(specContent);
    const ctx = createContext();

    await materializer.materialize(
      { type: 'ycforge:api-gateway', name: 'openapi', value: { specPath, resourceReferences: [] } } as never,
      ctx,
    );

    const companionPath = join(tmpDir, 'generated', 'openapi-openapi.yaml');
    const content = readFileSync(companionPath, 'utf8');
    expect(content).toBe(specContent);
  });

  it('repeat-call is deterministic (SC-006)', async () => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'apigw-'));
    process.chdir(tmpDir);

    const specPath = makeSpecFile(makeSpecContent());
    const refs = [{ logical: 'functions.user_service', terraformType: 'yandex_function' }];

    const r1 = (await materializer.materialize(
      { type: 'ycforge:api-gateway', name: 'openapi', value: { specPath, resourceReferences: refs } } as never,
      createContext(),
    )) as TerraformResource;
    const r2 = (await materializer.materialize(
      { type: 'ycforge:api-gateway', name: 'openapi', value: { specPath, resourceReferences: refs } } as never,
      createContext(),
    )) as TerraformResource;
    expect(r1).toEqual(r2);
  });

  it('declares output gateway_id (FR-005)', async () => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'apigw-'));
    process.chdir(tmpDir);

    const specPath = makeSpecFile(makeSpecContent());
    const ctx = createContext();

    await materializer.materialize(
      { type: 'ycforge:api-gateway', name: 'openapi', value: { specPath, resourceReferences: [] } } as never,
      ctx,
    );

    expect(ctx.output.declared.get('openapi_gateway_id')).toEqual({
      value: 'yandex_api_gateway.openapi.id',
    });
  });

  it('spec attribute is file() expression verbatim (DQ-1)', async () => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'apigw-'));
    process.chdir(tmpDir);

    const specPath = makeSpecFile(makeSpecContent());
    const ctx = createContext();
    const result = (await materializer.materialize(
      { type: 'ycforge:api-gateway', name: 'openapi', value: { specPath, resourceReferences: [] } } as never,
      ctx,
    )) as TerraformResource;
    const config = result.configuration as { spec: string };
    expect(config.spec).toBe('file("${path.module}/generated/openapi-openapi.yaml")');
  });

  it('TF address grammar (FR-004)', async () => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'apigw-'));
    process.chdir(tmpDir);

    const TF_ADDR = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    const specPath = makeSpecFile(makeSpecContent());
    const result = (await materializer.materialize(
      { type: 'ycforge:api-gateway', name: 'openapi', value: { specPath, resourceReferences: [] } } as never,
      createContext(),
    )) as TerraformResource;
    expect(TF_ADDR.test(result.type)).toBe(true);
    expect(TF_ADDR.test(result.name)).toBe(true);
  });

  it('throws YMT_INVALID_ARTIFACT_VALUE when specPath missing', async () => {
    savedCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'apigw-'));
    process.chdir(tmpDir);

    await expect(
      materializer.materialize(
        { type: 'ycforge:api-gateway', name: 'x', value: { specPath: '', resourceReferences: [] } } as never,
        createContext(),
      ),
    ).rejects.toMatchObject({ code: YMT_INVALID_ARTIFACT_VALUE });
  });
});
