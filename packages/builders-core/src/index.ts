/**
 * @ycforge/builders-core — root entry. Exports the artifact catalog (FR-003)
 * and the standalone structural types. Individual builders live on subpath
 * exports (`@ycforge/builders-core/nestjs-function`, `/docker`, `/vite`),
 * each default-exporting a spec-002 Builder shape (FR-001).
 */

export const BUILDERS_CORE_VERSION = '0.1.0';

export { ARTIFACT_TYPES, type ArtifactType } from './types.js';
export type {
  Artifact,
  Builder,
  BuildContext,
  DockerArtifactValue,
  FrontendArtifactValue,
  FunctionArtifactValue,
  NestjsFunctionBuildConfig,
  DockerBuildConfig,
  ViteBuildConfig,
} from './types.js';

export { catalog, type CatalogEntry } from './catalog.js';
export type { EnvScanResult } from './env.js';
export { BLC_ARCHIVE_FAILED, BLC_BUILD_FAILED, BLC_ENV_NOT_RESOLVED, BLC_ENTRY_NOT_FOUND, BLC_IMAGE_DIGEST_UNAVAILABLE, BLC_INVALID_CONFIG, BLC_MISSING_SOURCE } from './diagnostics.js';
export type { BuilderError } from './diagnostics.js';