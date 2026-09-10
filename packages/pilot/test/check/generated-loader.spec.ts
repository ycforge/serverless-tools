import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { loadGeneratedModel } from '../../src/check/generated-loader.js';

let tempDir: string;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function createDir(relPath: string): string {
  const full = join(tempDir, relPath);
  mkdirSync(full, { recursive: true });
  return full;
}

function writeFile(relPath: string, content: string): void {
  const full = join(tempDir, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

describe('generated-loader (T014)', () => {
  it('empty .ycsf/ dir → empty array', () => {
    tempDir = join(tmpdir(), 'pilot-check-loader-');
    createDir('.ycsf');
    const result = loadGeneratedModel(tempDir);
    expect(result).toEqual([]);
  });

  it('single file with resource block → parsed GeneratedResource[]', () => {
    tempDir = join(tmpdir(), 'pilot-check-loader-');
    createDir('.ycsf');
    writeFile(
      '.ycsf/yandex-function.user_service.ycsf.tf.json',
      JSON.stringify({
        resource: {
          yandex_function: {
            user_service: { runtime: 'nodejs22' },
          },
        },
      }),
    );

    const result = loadGeneratedModel(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      kind: 'resource',
      type: 'yandex_function',
      name: 'user_service',
      configuration: { runtime: 'nodejs22' },
    });
  });

  it('multiple files → flattened array', () => {
    tempDir = join(tmpdir(), 'pilot-check-loader-');
    createDir('.ycsf');
    writeFile(
      '.ycsf/yandex-function.user_service.ycsf.tf.json',
      JSON.stringify({ resource: { yandex_function: { user_service: { runtime: 'nodejs22' } } } }),
    );
    writeFile(
      '.ycsf/yandex-api-gateway.main.ycsf.tf.json',
      JSON.stringify({ resource: { yandex_api_gateway: { main: { name: 'main' } } } }),
    );

    const result = loadGeneratedModel(tempDir);
    expect(result).toHaveLength(2);
    const types = result.map((r) => r.type).sort();
    expect(types).toEqual(['yandex_api_gateway', 'yandex_function']);
  });

  it('file without resource key → skipped (no throw)', () => {
    tempDir = join(tmpdir(), 'pilot-check-loader-');
    createDir('.ycsf');
    writeFile(
      '.ycsf/some-file.ycsf.tf.json',
      JSON.stringify({ output: { foo: { value: 'bar' } } }),
    );

    const result = loadGeneratedModel(tempDir);
    expect(result).toEqual([]);
  });

  it('generatedDir option overrides default path', () => {
    tempDir = join(tmpdir(), 'pilot-check-loader-');
    const customDir = join(tempDir, 'custom-gen');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(
      join(customDir, 'yandex-function.fn1.ycsf.tf.json'),
      JSON.stringify({ resource: { yandex_function: { fn1: { runtime: 'nodejs18' } } } }),
      'utf8',
    );

    const result = loadGeneratedModel(tempDir, customDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('fn1');
  });

  it('missing .ycsf/ dir → empty array', () => {
    tempDir = join(tmpdir(), 'pilot-check-loader-');
    mkdirSync(tempDir, { recursive: true });
    const result = loadGeneratedModel(tempDir);
    expect(result).toEqual([]);
  });
});
