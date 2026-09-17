import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BLC_ARCHIVE_FAILED,
  BLC_BUILD_FAILED,
  BLC_DOCKER_UNREACHABLE,
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
  ['BLC_DOCKER_UNREACHABLE', 'BLC_DOCKER_UNREACHABLE'],
]);

describe('diagnostics codes match contracts/builders-core.json #/errorCodes (Constitution V)', () => {
  it('all eight BLC_* constants are exported', () => {
    const actual = {
      BLC_INVALID_CONFIG,
      BLC_MISSING_SOURCE,
      BLC_ENTRY_NOT_FOUND,
      BLC_BUILD_FAILED,
      BLC_ENV_NOT_RESOLVED,
      BLC_IMAGE_DIGEST_UNAVAILABLE,
      BLC_ARCHIVE_FAILED,
      BLC_DOCKER_UNREACHABLE,
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
      'BLC_DOCKER_UNREACHABLE',
    ]);
    expect([...new Set(Object.keys(contract.errorCodes.properties))].sort()).toEqual([...exportSet].sort());
  });

  it('builders-core.json dockerBuildConfig is additive: dev-mode image fields + BLC_DOCKER_UNREACHABLE (spec 028)', () => {
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as {
      definitions: {
        dockerBuildConfig: {
          properties: {
            image: {
              properties: Record<string, unknown>;
              required?: string[];
              oneOf?: unknown;
              additionalProperties: boolean;
            };
            dockerfile?: unknown;
          };
          required: string[];
        };
      };
      errorCodes: {
        properties: {
          BLC_IMAGE_DIGEST_UNAVAILABLE: { const: string; description: string };
          BLC_DOCKER_UNREACHABLE: { const: string; description: string };
        };
      };
    };
    const image = contract.definitions.dockerBuildConfig.properties.image;
    expect(image.properties.no_push).toMatchObject({ type: 'boolean', default: false });
    expect((image.properties.no_push as { description: string }).description).toMatch(/only-build/);
    expect(image.properties.repository).toEqual({ type: 'string', minLength: 1 });
    expect(image.properties.tag).toEqual({
      type: 'string',
      default: 'latest',
      pattern: '^[^\\s][^\\s]*$',
      description: 'Push tag; never used as the artifact image (only the digest form is).',
    });
    expect(image.properties.mode).toEqual({
      type: 'string',
      enum: ['registry-ref', 'remote'],
      description: expect.stringContaining('registry-ref') as unknown,
    });
    expect(image.properties.ref).toMatchObject({ type: 'string', pattern: '^[^@]+@sha256:[0-9a-f]{64}$' });
    expect((image.properties.ref as { description: string }).description).toMatch(/never a mutable tag/);
    expect(image.properties.host).toMatchObject({ type: 'string' });
    expect(image.additionalProperties).toBe(false);
    expect(image.oneOf).toEqual([{ required: ['repository'] }, { required: ['ref'] }]);
    expect(image.required).toBeUndefined();
    expect(contract.definitions.dockerBuildConfig.required).toEqual(['image']);
    expect(contract.definitions.dockerBuildConfig.properties.dockerfile).toEqual({ type: 'string', default: 'Dockerfile' });
    const digestCode = contract.errorCodes.properties.BLC_IMAGE_DIGEST_UNAVAILABLE;
    expect(digestCode.const).toBe('BLC_IMAGE_DIGEST_UNAVAILABLE');
    expect(digestCode.description).toMatch(/no-push mode/);
    expect(digestCode.description).toContain('{{.Id}}');
    const unreachableCode = contract.errorCodes.properties.BLC_DOCKER_UNREACHABLE;
    expect(unreachableCode.const).toBe('BLC_DOCKER_UNREACHABLE');
    expect(unreachableCode.description).toMatch(/daemon/);
  });
});