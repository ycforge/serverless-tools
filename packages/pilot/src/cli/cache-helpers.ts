// spec 022 — cache observability helpers
import type { CacheCheckResult, CacheReason } from '../contracts/cache.js';

export function formatCacheLine(result: CacheCheckResult): string {
  const short = result.fingerprint.slice(0, 8);
  if (result.hit) {
    return `  • cache hit  ${result.appId}  (${short}) — skipped build`;
  }
  const reasonMap: Record<CacheReason, string> = {
    hit: 'hit',
    no_entry: 'no cache entry',
    source_changed: 'source changed',
    build_config_changed: 'build_config changed',
    build_env_changed: 'build_env changed',
    builder_changed: 'builder changed',
    dependency_changed: 'dependency changed',
    no_cache: '--no-cache',
    blob_missing: 'blob missing — rebuilding',
    corrupted: 'corrupted — rebuilding',
  };
  const human = reasonMap[result.reason] ?? result.reason;
  if (result.reason === 'blob_missing' || result.reason === 'corrupted') {
    return `  ! cache corrupted for ${result.appId} (${short}) — rebuilding`;
  }
  if (result.reason === 'dependency_changed') {
    return `  • cache miss  ${result.appId}  (${short}) — dependency changed`;
  }
  return `  • cache miss  ${result.appId}  (${short}) — ${human}`;
}
