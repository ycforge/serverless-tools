import { describe, expect, it } from 'vitest';

import materializer from '../../src/yandex-serverless-container/index.js';
import { YMT_INVALID_ARTIFACT_VALUE } from '../../src/diagnostics.js';
import { createOutputBuilder } from '../../src/helpers/output-builder.js';
import type { OutputBuilderWithCollection } from '../../src/helpers/output-builder.js';
import type { MaterializationContext, TerraformResource } from '../../src/types.js';

function createContext(): MaterializationContext & { output: OutputBuilderWithCollection } {
  return { output: createOutputBuilder() };
}

const IMAGE = 'cr.yandex/app@sha256:abc123def456';
const artifact = {
  type: 'ycforge:docker-image',
  name: 'analytics',
  value: { image: IMAGE },
};

describe('yandex-serverless-container materializer (US2, T060)', () => {
  it('supports ycforge:docker-image and rejects others (FR-011)', () => {
    const ctx = createContext();
    expect(materializer.supports(artifact as never, ctx)).toBe(true);
    expect(materializer.supports({ type: 'ycforge:function', value: {} } as never, ctx)).toBe(false);
  });

  it('generates yandex_serverless_container with image as-is (AC1, FR-012/013)', async () => {
    const ctx = createContext();
    const result = (await materializer.materialize(artifact as never, ctx)) as TerraformResource;
    expect(result.kind).toBe('resource');
    expect(result.type).toBe('yandex_serverless_container');
    expect(result.name).toBe('analytics');
    expect(result.configuration).toEqual({ image: IMAGE, name: 'analytics' });
  });

  it('image is not transformed (FR-013)', async () => {
    const ctx = createContext();
    const result = (await materializer.materialize(artifact as never, ctx)) as TerraformResource;
    const config = result.configuration as { image: string };
    expect(config.image).toBe(IMAGE);
  });

  it('repeat-call is deterministic (SC-006)', async () => {
    const ctx1 = createContext();
    const ctx2 = createContext();
    const r1 = (await materializer.materialize(artifact as never, ctx1)) as TerraformResource;
    const r2 = (await materializer.materialize(artifact as never, ctx2)) as TerraformResource;
    expect(r1).toEqual(r2);
  });

  it('declares output container_id (FR-005)', async () => {
    const ctx = createContext();
    await materializer.materialize(artifact as never, ctx);
    expect(ctx.output.declared.get('analytics_container_id')).toEqual({
      value: 'yandex_serverless_container.analytics.id',
    });
  });

  it('TF address grammar (FR-004)', async () => {
    const TF_ADDR = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    const ctx = createContext();
    const result = (await materializer.materialize(artifact as never, ctx)) as TerraformResource;
    expect(TF_ADDR.test(result.type)).toBe(true);
    expect(TF_ADDR.test(result.name)).toBe(true);
  });

  it('throws YMT_INVALID_ARTIFACT_VALUE when image missing', async () => {
    const ctx = createContext();
    await expect(
      materializer.materialize(
        { type: 'ycforge:docker-image', name: 'x', value: { image: '' } } as never,
        ctx,
      ),
    ).rejects.toMatchObject({ code: YMT_INVALID_ARTIFACT_VALUE });
  });
});
