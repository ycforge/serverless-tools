import { describe, expect, it } from 'vitest';
import { isAbsolute } from 'node:path';

import materializer from '../../src/yandex-function/index.js';
import { YMT_INVALID_ARTIFACT_VALUE } from '../../src/diagnostics.js';
import { createOutputBuilder } from '../../src/helpers/output-builder.js';
import type { OutputBuilderWithCollection } from '../../src/helpers/output-builder.js';
import type { MaterializationContext, TerraformResource } from '../../src/types.js';
import { makeArchiveBytes, makeTempDir, makeZipUnder } from '../helpers/fixtures.js';

function createContext(): MaterializationContext & { output: OutputBuilderWithCollection } {
  return { output: createOutputBuilder() };
}

describe('yandex-function materializer (US1, T040)', () => {
  const tmpRoot = makeTempDir('func-');

  const archive = makeZipUnder(tmpRoot, 'function.zip', makeArchiveBytes());

  const artifact = {
    type: 'ycforge:function',
    name: 'user_service',
    value: { archivePath: archive.relativePath, entryPoint: 'index.handler' },
  };

  it('supports ycforge:function and rejects other types (AC2, FR-006)', () => {
    const ctx = createContext();
    expect(materializer.supports(artifact as never, ctx)).toBe(true);
    expect(materializer.supports({ type: 'ycforge:docker-image', value: { image: 'x' } } as never, ctx)).toBe(false);
  });

  it('generates yandex_function TerraformResource with correct config (AC1, FR-007..010)', async () => {
    const ctx = createContext();
    const result = (await materializer.materialize(artifact as never, ctx)) as TerraformResource;
    expect(result.kind).toBe('resource');
    expect(result.type).toBe('yandex_function');
    expect(result.name).toBe('user_service');
    expect(result.configuration).toEqual({
      runtime: 'nodejs22',
      entrypoint: 'index.handler',
      user_hash: archive.sha256,
      content: {
        zip_filename: archive.relativePath,
      },
    });
  });

  it('zip_filename equals value.archivePath verbatim and is not absolute (FR-010, DQ-2)', async () => {
    const ctx = createContext();
    const result = (await materializer.materialize(artifact as never, ctx)) as TerraformResource;
    const config = result.configuration as { content: { zip_filename: string } };
    expect(config.content.zip_filename).toBe(archive.relativePath);
    expect(isAbsolute(config.content.zip_filename)).toBe(false);
  });

  it('user_hash matches fixture SHA-256 (FR-009, D-RE-6)', async () => {
    const ctx = createContext();
    const result = (await materializer.materialize(artifact as never, ctx)) as TerraformResource;
    const config = result.configuration as { user_hash: string };
    expect(config.user_hash).toBe(archive.sha256);
  });

  it('repeat-call is deterministic (SC-006)', async () => {
    const ctx1 = createContext();
    const ctx2 = createContext();
    const r1 = (await materializer.materialize(artifact as never, ctx1)) as TerraformResource;
    const r2 = (await materializer.materialize(artifact as never, ctx2)) as TerraformResource;
    expect(r1).toEqual(r2);
  });

  it('declares output function_id (AC3, FR-005)', async () => {
    const ctx = createContext();
    await materializer.materialize(artifact as never, ctx);
    expect(ctx.output.declared.get('user_service_function_id')).toEqual({
      value: 'yandex_function.user_service.id',
    });
  });

  it('TF address grammar for type/name (FR-004)', async () => {
    const TF_ADDR = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    const ctx = createContext();
    const result = (await materializer.materialize(artifact as never, ctx)) as TerraformResource;
    expect(TF_ADDR.test(result.type)).toBe(true);
    expect(TF_ADDR.test(result.name)).toBe(true);
  });

  it('throws YMT_INVALID_ARTIFACT_VALUE when archivePath missing', async () => {
    const ctx = createContext();
    await expect(
      materializer.materialize(
        { type: 'ycforge:function', name: 'x', value: { archivePath: '', entryPoint: 'h' } } as never,
        ctx,
      ),
    ).rejects.toMatchObject({ code: YMT_INVALID_ARTIFACT_VALUE });
  });

  it('throws YMT_INVALID_ARTIFACT_VALUE when entryPoint missing', async () => {
    const ctx = createContext();
    await expect(
      materializer.materialize(
        { type: 'ycforge:function', name: 'x', value: { archivePath: archive.relativePath, entryPoint: '' } } as never,
        ctx,
      ),
    ).rejects.toMatchObject({ code: YMT_INVALID_ARTIFACT_VALUE });
  });

  it('throws YMT_INVALID_ARTIFACT_VALUE for absolute archivePath (DQ-2)', async () => {
    const ctx = createContext();
    await expect(
      materializer.materialize(
        { type: 'ycforge:function', name: 'x', value: { archivePath: '/abs/path.zip', entryPoint: 'h' } } as never,
        ctx,
      ),
    ).rejects.toMatchObject({ code: YMT_INVALID_ARTIFACT_VALUE });
  });

  it('missing archive propagates a raw fs ENOENT error, not a YMT diagnostic (T119)', async () => {
    const ctx = createContext();
    const err = await materializer
      .materialize(
        { type: 'ycforge:function', name: 'user_service', value: { archivePath: 'missing-archive.zip', entryPoint: 'index.handler' } } as never,
        ctx,
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).not.toBeNull();
    const e = err as Error & { code?: string };
    expect(e.name).not.toBe('MaterializerError');
    expect(e.code).toBe('ENOENT');
  });
});
