import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BLC_ARCHIVE_FAILED,
  BLC_BUILD_FAILED,
  BLC_ENV_NOT_RESOLVED,
  BLC_ENTRY_NOT_FOUND,
  BLC_IMAGE_DIGEST_UNAVAILABLE,
  BLC_INVALID_CONFIG,
  BLC_MISSING_SOURCE,
} from '../../src/diagnostics.js';

const CONTRACT_PATH = new URL('../../../../specs/018-builders-core/contracts/builders-core.json', import.meta.url);
const EXPECTED = new Map<string, string>([
  ['BLC_INVALID_CONFIG', 'BLC_INVALID_CONFIG'],
  ['BLC_MISSING_SOURCE', 'BLC_MISSING_SOURCE'],
  ['BLC_ENTRY_NOT_FOUND', 'BLC_ENTRY_NOT_FOUND'],
  ['BLC_BUILD_FAILED', 'BLC_BUILD_FAILED'],
  ['BLC_ENV_NOT_RESOLVED', 'BLC_ENV_NOT_RESOLVED'],
  ['BLC_IMAGE_DIGEST_UNAVAILABLE', 'BLC_IMAGE_DIGEST_UNAVAILABLE'],
  ['BLC_ARCHIVE_FAILED', 'BLC_ARCHIVE_FAILED'],
]);

describe('diagnostics codes match contracts/builders-core.json #/errorCodes (Constitution V)', () => {
  it('all seven BLC_* constants are exported', () => {
    const actual = {
      BLC_INVALID_CONFIG,
      BLC_MISSING_SOURCE,
      BLC_ENTRY_NOT_FOUND,
      BLC_BUILD_FAILED,
      BLC_ENV_NOT_RESOLVED,
      BLC_IMAGE_DIGEST_UNAVAILABLE,
      BLC_ARCHIVE_FAILED,
    };
    for (const [name, value] of Object.entries(actual)) {
      expect(value).toBe(EXPECTED.get(name));
    }
  });

  it('the exported set exactly equals the contract errorCodes key set', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as {
      errorCodes: { properties: Record<string, unknown> };
    };
    const exportSet = new Set([
      'BLC_INVALID_CONFIG',
      'BLC_MISSING_SOURCE',
      'BLC_ENTRY_NOT_FOUND',
      'BLC_BUILD_FAILED',
      'BLC_ENV_NOT_RESOLVED',
      'BLC_IMAGE_DIGEST_UNAVAILABLE',
      'BLC_ARCHIVE_FAILED',
    ]);
    expect([...new Set(Object.keys(contract.errorCodes.properties))].sort()).toEqual([...exportSet].sort());
  });
});