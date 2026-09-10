// spec 022 — cache facade
import type { CacheCheckResult, CacheManifest, CacheReason } from '../contracts/cache.js';
import { hasValidBlob } from './blobs.js';

export type { CacheCheckResult, CacheReason, CacheSummary, CacheEntry, CacheManifest } from '../contracts/cache.js';

export interface CheckCacheOpts {
  readonly noCache?: boolean;
  readonly effectiveFingerprint: string;
  readonly appId: string;
  readonly manifest: CacheManifest | null;
  readonly cacheDir: string;
  readonly own: { filesHash: string; buildConfigHash: string; buildEnvHash: string; builder: string };
  readonly depFingerprints: readonly string[];
}

export async function checkCache(opts: CheckCacheOpts): Promise<CacheCheckResult> {
  const { noCache, effectiveFingerprint, appId, manifest, cacheDir, own, depFingerprints } = opts;
  if (noCache) {
    return { appId, hit: false, fingerprint: effectiveFingerprint, reason: 'no_cache' };
  }
  if (!manifest || !manifest.entries[appId]) {
    return { appId, hit: false, fingerprint: effectiveFingerprint, reason: 'no_entry' };
  }
  const entry = manifest.entries[appId]!;
  // blob validity
  const valid = await hasValidBlob(cacheDir, effectiveFingerprint);
  // If effective matches and blob valid → hit, otherwise check blob for stored effective?
  // Need to check blob for the computed effective, not stored? spec FR-010: hit only if effective == computed && blob exists
  // Also if stored effective != computed → miss, but blob missing also miss
  // We check computed blob existence; if missing treat as blob_missing even if fingerprint matches stored
  if (entry.effectiveFingerprint !== effectiveFingerprint) {
    // Determine reason priority
    // If blob missing for computed fp, but also fingerprint mismatch, priority: blob_missing still? spec says blob_missing check before fingerprint diff
    // But we already checked valid for computed fp; if not valid → blob_missing
    if (!valid) {
      return { appId, hit: false, fingerprint: effectiveFingerprint, reason: 'blob_missing' };
    }
    // Compare component diff
    const reason = detectReason(entry, own, depFingerprints);
    return { appId, hit: false, fingerprint: effectiveFingerprint, reason };
  }
  // effective matches
  if (!valid) {
    return { appId, hit: false, fingerprint: effectiveFingerprint, reason: 'blob_missing' };
  }
  return { appId, hit: true, fingerprint: effectiveFingerprint, reason: 'hit', blobPath: `${cacheDir}/blobs/${effectiveFingerprint}` };
}

function detectReason(
  entry: { filesHash?: string; buildConfigHash?: string; buildEnvHash?: string; builder?: string; dependsOnFingerprints?: readonly string[] },
  own: { filesHash: string; buildConfigHash: string; buildEnvHash: string; builder: string },
  depFingerprints: readonly string[],
): CacheReason {
  if (entry.filesHash !== undefined && entry.filesHash !== own.filesHash) return 'source_changed';
  if (entry.buildConfigHash !== undefined && entry.buildConfigHash !== own.buildConfigHash) return 'build_config_changed';
  if (entry.buildEnvHash !== undefined && entry.buildEnvHash !== own.buildEnvHash) return 'build_env_changed';
  if (entry.builder !== undefined && entry.builder !== own.builder) return 'builder_changed';
  // dependency change if dep fingerprints differ
  const storedDeps = entry.dependsOnFingerprints ?? [];
  const a = [...storedDeps].sort().join('|');
  const b = [...depFingerprints].sort().join('|');
  if (a !== b) return 'dependency_changed';
  // fallback: if no component info, treat as source_changed or dependency?
  // If deps differ but not stored, assume dependency_changed if deps non-empty else source_changed
  if (depFingerprints.length > 0 && storedDeps.length === 0) return 'dependency_changed';
  // generic fallback
  if (entry.filesHash === undefined) {
    // no granular info → try to infer via builder vs source: default source_changed
    return 'source_changed';
  }
  return 'source_changed';
}
