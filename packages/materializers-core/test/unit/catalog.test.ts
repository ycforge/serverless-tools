import { describe, expect, it } from 'vitest';

import { ARTIFACT_CATALOG, ARTIFACT_TYPES, MATERIALIZER_IDS } from '@ycforge/materializers-core';
import type { ArtifactType, MaterializerId } from '@ycforge/materializers-core';

const IS_ARTIFACT_TYPE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

const EXPECTED: readonly [MaterializerId, ArtifactType][] = [
  ['yandex-function', 'ycforge:function'],
  ['yandex-serverless-container', 'ycforge:docker-image'],
  ['yandex-api-gateway', 'ycforge:api-gateway'],
  ['yandex-message-queue', 'ycforge:queue'],
  ['yandex-storage-bucket', 'ycforge:frontend'],
];

describe('materializer artifact catalog (FR-003, D-3)', () => {
  it('MATERIALIZER_IDS is exactly the five materializer ids', () => {
    expect(MATERIALIZER_IDS).toEqual([
      'yandex-function',
      'yandex-serverless-container',
      'yandex-api-gateway',
      'yandex-message-queue',
      'yandex-storage-bucket',
    ]);
  });

  it('maps materializer id → artifact type for all five entries (incl. D-3 forward contracts)', () => {
    for (const [id, artifactType] of EXPECTED) {
      expect(ARTIFACT_CATALOG[id].artifactType).toBe(artifactType);
    }
    expect(Object.keys(ARTIFACT_CATALOG)).toEqual([...MATERIALIZER_IDS]);
  });

  it('ARTIFACT_TYPES is a frozen 5-element array covering the full ArtifactType union', () => {
    expect(Object.isFrozen(ARTIFACT_TYPES)).toBe(true);
    expect(ARTIFACT_TYPES).toEqual([
      'ycforge:function',
      'ycforge:docker-image',
      'ycforge:api-gateway',
      'ycforge:queue',
      'ycforge:frontend',
    ]);
  });

  it('every artifact type honours the pilot isArtifactType grammar', () => {
    for (const artifactType of ARTIFACT_TYPES) {
      expect(IS_ARTIFACT_TYPE.test(artifactType)).toBe(true);
    }
  });
});