/**
 * @ycforge/materializers-core — root entry. Exports the materializer catalog
 * (FR-003), the YMT_* diagnostics family, and the standalone structural types.
 * Individual materializers live on subpath exports
 * (`@ycforge/materializers-core/yandex-function`,
 * `/yandex-serverless-container`, `/yandex-api-gateway`,
 * `/yandex-message-queue`, `/yandex-storage-bucket`), each default-exporting a
 * spec-002 Materializer shape (FR-001).
 */

export const MATERIALIZERS_CORE_VERSION = '0.1.0';

export { ARTIFACT_CATALOG, ARTIFACT_TYPES, MATERIALIZER_IDS } from './catalog.js';
export type { ArtifactType, MaterializerId } from './catalog.js';

export {
  YMT_EMPTY_DIRECTORY,
  YMT_INVALID_ARTIFACT_VALUE,
  YMT_INVALID_QUEUE_URL,
  materializerError,
} from './diagnostics.js';
export type { MaterializerError, MaterializerErrorOptions } from './diagnostics.js';

export type {
  ApiGatewayArtifactValue,
  Artifact,
  DockerArtifactValue,
  FrontendArtifactValue,
  FunctionArtifactValue,
  MaterializationContext,
  Materializer,
  OutputBuilder,
  QueueArtifactValue,
  ResourceReference,
  TerraformResource,
} from './types.js';