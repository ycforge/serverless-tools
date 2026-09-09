import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  YMT_EMPTY_DIRECTORY,
  YMT_INVALID_ARTIFACT_VALUE,
  YMT_INVALID_QUEUE_URL,
  materializerError,
  type MaterializerError,
} from '../../src/diagnostics.js';

const CONTRACT_PATH = new URL(
  '../../../../specs/019-materializers-yandex/contracts/materializers-core.json',
  import.meta.url,
);

const CONSTANTS: Record<string, string> = {
  YMT_INVALID_QUEUE_URL,
  YMT_INVALID_ARTIFACT_VALUE,
  YMT_EMPTY_DIRECTORY,
};

describe('YMT_* diagnostics vs contracts/materializers-core.json (FR-026/027, Constitution V)', () => {
  it('exports exactly the three YMT_* constants', () => {
    expect(Object.values(CONSTANTS)).toEqual([
      'YMT_INVALID_QUEUE_URL',
      'YMT_INVALID_ARTIFACT_VALUE',
      'YMT_EMPTY_DIRECTORY',
    ]);
  });

  it('the exported set byte-for-byte matches the contract errorCodes key set', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as {
      errorCodes: { properties: Record<string, unknown>; required: string[] };
    };
    expect(Object.keys(contract.errorCodes.properties).sort()).toEqual([...Object.values(CONSTANTS)].sort());
    expect([...contract.errorCodes.required].sort()).toEqual([...Object.values(CONSTANTS)].sort());
  });

  it('materializerError produces a MaterializerError with name and code', () => {
    const err = materializerError(YMT_INVALID_QUEUE_URL, 'invalid queueUrl format: x') as MaterializerError;
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('MaterializerError');
    expect(err.code).toBe(YMT_INVALID_QUEUE_URL);
    expect(err.materializer).toBeUndefined();
  });

  it('binds the materializer option when provided', () => {
    const err = materializerError(YMT_INVALID_ARTIFACT_VALUE, 'missing field: archivePath', {
      materializer: 'yandex-function',
    });
    expect(err.materializer).toBe('yandex-function');
  });
});