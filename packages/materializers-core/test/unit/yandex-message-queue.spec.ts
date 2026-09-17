import { describe, expect, it } from 'vitest';

import materializer from '../../src/yandex-message-queue/index.js';
import { YMT_INVALID_ARTIFACT_VALUE, YMT_INVALID_QUEUE_URL } from '../../src/diagnostics.js';
import { createOutputBuilder } from '../../src/helpers/output-builder.js';
import type { OutputBuilderWithCollection } from '../../src/helpers/output-builder.js';
import type { MaterializationContext, TerraformResource } from '../../src/types.js';
import { makeQueueUrl } from '../helpers/fixtures.js';

function createContext(): MaterializationContext & { output: OutputBuilderWithCollection } {
  return { output: createOutputBuilder() };
}

const validUrl = makeQueueUrl(true);
const invalidUrl = makeQueueUrl(false);

describe('yandex-message-queue materializer (US3, T080)', () => {
  it('supports ycforge:queue and rejects others (FR-018)', () => {
    const ctx = createContext();
    expect(materializer.supports({ type: 'ycforge:queue', value: { queueUrl: validUrl } } as never, ctx)).toBe(true);
    expect(materializer.supports({ type: 'ycforge:function', value: {} } as never, ctx)).toBe(false);
  });

  it('generates yandex_message_queue with queue_name + region (FR-019)', async () => {
    const ctx = createContext();
    const result = (await materializer.materialize(
      { type: 'ycforge:queue', name: 'notifications', value: { queueUrl: validUrl } } as never,
      ctx,
    )) as TerraformResource;
    expect(result.kind).toBe('resource');
    expect(result.type).toBe('yandex_message_queue');
    expect(result.name).toBe('notifications');
    expect(result.configuration).toEqual({ queue_name: 'my-queue', region: 'ru-central1' });
  });

  it('queue_name is last segment after /queues/ (DQ-9)', async () => {
    const ctx = createContext();
    const result = (await materializer.materialize(
      { type: 'ycforge:queue', name: 'q', value: { queueUrl: 'https://message-queue.api.cloud.yandex.net/b1g1/queues/my-queue' } } as never,
      ctx,
    )) as TerraformResource;
    expect((result.configuration as { queue_name: string }).queue_name).toBe('my-queue');
  });

  it('region defaults to ru-central1 (DQ-9)', async () => {
    const ctx = createContext();
    const result = (await materializer.materialize(
      { type: 'ycforge:queue', name: 'q', value: { queueUrl: validUrl } } as never,
      ctx,
    )) as TerraformResource;
    expect((result.configuration as { region: string }).region).toBe('ru-central1');
  });

  it('throws YMT_INVALID_QUEUE_URL for URL without /queues/ (FR-020)', async () => {
    const ctx = createContext();
    await expect(
      materializer.materialize(
        { type: 'ycforge:queue', name: 'q', value: { queueUrl: invalidUrl } } as never,
        ctx,
      ),
    ).rejects.toMatchObject({ code: YMT_INVALID_QUEUE_URL });
  });

  it('throws YMT_INVALID_QUEUE_URL for unparseable URL', async () => {
    const ctx = createContext();
    await expect(
      materializer.materialize(
        { type: 'ycforge:queue', name: 'q', value: { queueUrl: 'not-a-url' } } as never,
        ctx,
      ),
    ).rejects.toMatchObject({ code: YMT_INVALID_QUEUE_URL });
  });

  it('throws YMT_INVALID_ARTIFACT_VALUE when queueUrl missing', async () => {
    const ctx = createContext();
    await expect(
      materializer.materialize(
        { type: 'ycforge:queue', name: 'q', value: { queueUrl: '' } } as never,
        ctx,
      ),
    ).rejects.toMatchObject({ code: YMT_INVALID_ARTIFACT_VALUE });
  });

  it('declares output queue_id (FR-005)', async () => {
    const ctx = createContext();
    await materializer.materialize(
      { type: 'ycforge:queue', name: 'notifications', value: { queueUrl: validUrl } } as never,
      ctx,
    );
    expect(ctx.output.declared.get('notifications_queue_id')).toEqual({
      value: 'yandex_message_queue.notifications.id',
    });
  });

  it('repeat-call is deterministic (SC-006)', async () => {
    const ctx1 = createContext();
    const ctx2 = createContext();
    const r1 = (await materializer.materialize(
      { type: 'ycforge:queue', name: 'q', value: { queueUrl: validUrl } } as never,
      ctx1,
    )) as TerraformResource;
    const r2 = (await materializer.materialize(
      { type: 'ycforge:queue', name: 'q', value: { queueUrl: validUrl } } as never,
      ctx2,
    )) as TerraformResource;
    expect(r1).toEqual(r2);
  });

  it('TF address grammar (FR-004)', async () => {
    const TF_ADDR = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    expect(TF_ADDR.test('yandex_message_queue')).toBe(true);
    expect(TF_ADDR.test('notifications')).toBe(true);
  });
});
