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

interface ValueSchema {
  definitions: {
    artifact: { required: string[]; properties: Record<string, { type?: string; pattern?: string; description?: string }> };
    functionArtifactValue: { properties: { archivePath: { description: string } } };
    frontendArtifactValue: { properties: { directory: { description: string } } };
    dockerArtifactValue: { properties: { image: { pattern: string; description: string } } };
  };
}

const CONTRACT = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as ValueSchema;

describe('contract value schemas vs implemented semantics (T115/T120)', () => {
  it('artifact definition requires `name` as a TF address (T114 mirror, T115)', () => {
    const artifact = CONTRACT.definitions.artifact;
    expect(artifact.required).toContain('name');
    expect(artifact.properties.name?.pattern).toBe('^[a-zA-Z_][a-zA-Z0-9_]*$');
    expect(artifact.properties.type?.type).toBe('string');
    expect(artifact.required).toEqual(['type', 'name', 'value']);
  });

  it('archivePath description pins the infra-relative (never absolute) semantics (T115, DQ-2)', () => {
    expect(CONTRACT.definitions.functionArtifactValue.properties.archivePath.description).toBe(
      'Infra-relative path to the .zip (never absolute); copied verbatim into content.zip_filename (DQ-2).',
    );
  });

  it('directory description pins the infra-relative (never absolute) semantics (T115)', () => {
    expect(CONTRACT.definitions.frontendArtifactValue.properties.directory.description).toBe(
      'Infra-relative path to static build output (never absolute).',
    );
  });

  it('docker image pattern accepts digests, short-hex fixtures and plain images, rejects mutable tags (T120)', () => {
    const { pattern } = CONTRACT.definitions.dockerArtifactValue.properties.image;
    const re = new RegExp(pattern);
    expect(re.test('cr.yandex/app@sha256:abc123def456')).toBe(true);
    expect(re.test(`cr.yandex/app@sha256:${'a'.repeat(64)}`)).toBe(true);
    expect(re.test('cr.yandex/app')).toBe(true);
    expect(re.test('cr.yandex/app:latest')).toBe(false);
  });
});