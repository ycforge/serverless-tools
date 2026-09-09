import { describe, expect, it } from 'vitest';

import materializer from '../../src/yandex-storage-bucket/index.js';
import { YMT_EMPTY_DIRECTORY, YMT_INVALID_ARTIFACT_VALUE } from '../../src/diagnostics.js';
import { createOutputBuilder } from '../../src/helpers/output-builder.js';
import type { OutputBuilderWithCollection } from '../../src/helpers/output-builder.js';
import type { MaterializationContext, TerraformResource } from '../../src/types.js';
import { makeEmptyDir, makeStaticDir } from '../helpers/fixtures.js';

function createContext(): MaterializationContext & { output: OutputBuilderWithCollection } {
  return { output: createOutputBuilder() };
}

describe('yandex-storage-bucket materializer (US2, T061)', () => {
  const staticDir = makeStaticDir(['index.html', 'style.css', 'app.js']);
  const emptyDir = makeEmptyDir();

  it('supports ycforge:frontend and rejects others (FR-021)', () => {
    const ctx = createContext();
    expect(materializer.supports({ type: 'ycforge:frontend', name: 'x', value: { directory: staticDir } } as never, ctx)).toBe(true);
    expect(materializer.supports({ type: 'ycforge:function', value: {} } as never, ctx)).toBe(false);
  });

  it('generates bucket + 3 objects for 3 files (AC2, FR-022/023)', async () => {
    const ctx = createContext();
    const result = (await materializer.materialize(
      { type: 'ycforge:frontend', name: 'frontend', value: { directory: staticDir } } as never,
      ctx,
    )) as readonly TerraformResource[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(4);

    const bucket = result[0]!;
    expect(bucket.kind).toBe('resource');
    expect(bucket.type).toBe('yandex_storage_bucket');
    expect(bucket.name).toBe('frontend');
    expect(bucket.configuration).toEqual({ bucket: 'frontend', acl: 'public-read' });

    const objectNames = result.slice(1).map((r) => r.name);
    expect(objectNames).toContain('frontend_index_html');
    expect(objectNames).toContain('frontend_style_css');
    expect(objectNames).toContain('frontend_app_js');
  });

  it('storage_object has correct key/source/bucket ref (FR-023)', async () => {
    const ctx = createContext();
    const result = (await materializer.materialize(
      { type: 'ycforge:frontend', name: 'frontend', value: { directory: staticDir } } as never,
      ctx,
    )) as readonly TerraformResource[];
    const objects = result.filter((r) => r.type === 'yandex_storage_object');
    for (const obj of objects) {
      expect(obj.configuration).toMatchObject({ bucket: 'yandex_storage_bucket.frontend.id' });
      expect(typeof (obj.configuration as Record<string, unknown>).key).toBe('string');
      expect(typeof (obj.configuration as Record<string, unknown>).source).toBe('string');
    }
    const keys = objects.map((o) => (o.configuration as { key: string }).key).sort();
    expect(keys).toEqual(['app.js', 'index.html', 'style.css']);
  });

  it('empty directory returns only bucket + YMT_EMPTY_DIRECTORY (AC3, DQ-5, FR-024)', async () => {
    const ctx = createContext();
    const result = (await materializer.materialize(
      { type: 'ycforge:frontend', name: 'frontend', value: { directory: emptyDir } } as never,
      ctx,
    )) as readonly TerraformResource[];
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
    expect(result[0]!.type).toBe('yandex_storage_bucket');

    const output = ctx.output.declared.get('frontend_bucket_id');
    expect(output).toBeDefined();
    expect(output!.description).toBe(YMT_EMPTY_DIRECTORY);
  });

  it('listing is alphabetically sorted (SC-006)', async () => {
    const ctx = createContext();
    const result = (await materializer.materialize(
      { type: 'ycforge:frontend', name: 'frontend', value: { directory: staticDir } } as never,
      ctx,
    )) as readonly TerraformResource[];
    const objectNames = result.filter((r) => r.type === 'yandex_storage_object').map((r) => r.name);
    expect(objectNames).toEqual([...objectNames].sort());
  });

  it('repeat-call is deterministic (SC-006)', async () => {
    const ctx1 = createContext();
    const ctx2 = createContext();
    const r1 = (await materializer.materialize(
      { type: 'ycforge:frontend', name: 'frontend', value: { directory: staticDir } } as never,
      ctx1,
    )) as readonly TerraformResource[];
    const r2 = (await materializer.materialize(
      { type: 'ycforge:frontend', name: 'frontend', value: { directory: staticDir } } as never,
      ctx2,
    )) as readonly TerraformResource[];
    expect(r1).toEqual(r2);
  });

  it('declares output bucket_id (FR-005)', async () => {
    const ctx = createContext();
    await materializer.materialize(
      { type: 'ycforge:frontend', name: 'frontend', value: { directory: staticDir } } as never,
      ctx,
    );
    expect(ctx.output.declared.get('frontend_bucket_id')).toEqual({
      value: 'yandex_storage_bucket.frontend.id',
    });
  });

  it('TF address grammar for all names (FR-004/025)', async () => {
    const TF_ADDR = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    const ctx = createContext();
    const result = (await materializer.materialize(
      { type: 'ycforge:frontend', name: 'frontend', value: { directory: staticDir } } as never,
      ctx,
    )) as readonly TerraformResource[];
    for (const r of result) {
      expect(TF_ADDR.test(r.type)).toBe(true);
      expect(TF_ADDR.test(r.name)).toBe(true);
    }
  });

  it('throws YMT_INVALID_ARTIFACT_VALUE when directory missing', async () => {
    const ctx = createContext();
    await expect(
      materializer.materialize(
        { type: 'ycforge:frontend', name: 'x', value: { directory: '' } } as never,
        ctx,
      ),
    ).rejects.toMatchObject({ code: YMT_INVALID_ARTIFACT_VALUE });
  });
});
