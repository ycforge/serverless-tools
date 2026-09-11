import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { YandexCloudFunctionHandler } from '@ycforge/nestjs-connector';
import { createHandler } from '../src/server/connector';
import type { ClosableYandexCloudFunctionHandler } from '@ycforge/nestjs-connector';

describe('createHandler (FR-007..009, S-4)', () => {
  it('returns a callable handler and a close function', () => {
    const result = createHandler(class TestModule {});
    expect(typeof result.handler).toBe('function');
    expect(typeof result.close).toBe('function');
  });

  it('delegates to the connector via the injected factory and keeps the same function identity', async () => {
    const fakeHandler = (async (
      _event: unknown,
      _context: unknown,
    ): Promise<unknown> => ({ statusCode: 200, headers: {}, body: '{}', isBase64Encoded: false })) as YandexCloudFunctionHandler;
    const factory = vi.fn(() => fakeHandler as unknown as ClosableYandexCloudFunctionHandler);

    const result = createHandler(class DelegatedModule {}, { createYandexHandler: factory });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(result.handler).toBe(fakeHandler);
    await expect(result.close()).resolves.toBeUndefined();
  });

  it('makes close idempotent', async () => {
    const fakeHandler = Object.assign(
      (async (): Promise<unknown> => 'x') as YandexCloudFunctionHandler,
      { close: vi.fn(async (): Promise<void> => undefined) },
    );
    const result = createHandler(class IdempotentModule {}, {
      createYandexHandler: vi.fn(() => fakeHandler),
    });

    await result.close();
    await expect(result.close()).resolves.toBeUndefined();
    const connectorClose = (fakeHandler as unknown as { close: ReturnType<typeof vi.fn> }).close;
    expect(connectorClose).toHaveBeenCalledTimes(1);
  });

  it('imports only the public connector root and no @nestjs/core (SC-008)', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/server/connector.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toContain('@nestjs/core');
    expect(source).not.toContain('NestFactory');
    expect(source).not.toContain('nestjs-connector/');
    expect(source).toContain("from '@ycforge/nestjs-connector'");
  });
});