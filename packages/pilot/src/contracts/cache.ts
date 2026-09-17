// spec 022 incremental-builds — cache contracts (S-1, S-6, FR-028)
export const CACHE_MANIFEST_VERSION = 1 as const;

export type CacheReason =
  | 'hit'
  | 'no_entry'
  | 'source_changed'
  | 'build_config_changed'
  | 'build_env_changed'
  | 'builder_changed'
  | 'dependency_changed'
  | 'no_cache'
  | 'blob_missing'
  | 'corrupted';

export interface CacheEntry {
  readonly fingerprint: string;
  readonly effectiveFingerprint: string;
  readonly artifactType: string;
  readonly createdAt: string;
  readonly dependsOnFingerprints: readonly string[];
  // optional component hashes for reason detection (not in JSON schema but stored)
  readonly filesHash?: string;
  readonly buildConfigHash?: string;
  readonly buildEnvHash?: string;
  readonly builder?: string;
}

export interface CacheManifest {
  readonly version: 1;
  readonly entries: Readonly<Record<string, CacheEntry>>;
}

export interface CacheCheckResult {
  readonly appId: string;
  readonly hit: boolean;
  readonly fingerprint: string;
  readonly reason: CacheReason;
  readonly blobPath?: string;
}

export interface CacheSummary {
  readonly hits: number;
  readonly misses: number;
  readonly entries: readonly CacheCheckResult[];
}
