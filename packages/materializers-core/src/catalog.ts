/**
 * Materializer catalog (FR-003): materializer id → artifact type.
 * Forward contract for 014/021 dispatch (`@ycforge/materializers-core/*`
 * subpaths resolve as registry entries) and for the two new artifact types
 * `ycforge:api-gateway` + `ycforge:queue` (D-3, forward contract).
 */

export const MATERIALIZER_IDS = [
  'yandex-function',
  'yandex-serverless-container',
  'yandex-api-gateway',
  'yandex-message-queue',
  'yandex-storage-bucket',
] as const;

export type MaterializerId = (typeof MATERIALIZER_IDS)[number];

/** A single catalog row: one materializer id paired with the artifact type it supports. */
export type MaterializerCatalogEntry = {
  readonly id: MaterializerId;
  readonly artifactType: ArtifactType;
};

export const ARTIFACT_CATALOG = {
  'yandex-function': { artifactType: 'ycforge:function' },
  'yandex-serverless-container': { artifactType: 'ycforge:docker-image' },
  'yandex-api-gateway': { artifactType: 'ycforge:api-gateway' },
  'yandex-message-queue': { artifactType: 'ycforge:queue' },
  'yandex-storage-bucket': { artifactType: 'ycforge:frontend' },
} as const;

/** The closed set of artifact types supported by this catalog (FR-003, D-3). */
export type ArtifactType = (typeof ARTIFACT_CATALOG)[MaterializerId]['artifactType'];

/** Runtime mirror of {@link ArtifactType}. */
export const ARTIFACT_TYPES: readonly ArtifactType[] = Object.freeze([
  'ycforge:function',
  'ycforge:docker-image',
  'ycforge:api-gateway',
  'ycforge:queue',
  'ycforge:frontend',
]);