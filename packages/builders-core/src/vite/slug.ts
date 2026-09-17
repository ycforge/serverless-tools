/**
 * Bucket-name slug resolution for the vite builder (spec 035).
 *
 * Yandex Object Storage bucket names are globally unique across the whole
 * cloud (S3-parity): a bare app id like `frontend` is almost certainly taken.
 * The vite builder therefore resolves an `<appId>-<slug>` default name and
 * persists the slug in `.ycsf/state.json` (project-local machine state, next
 * to the build cache) so a bucket name stays stable across builds, clones and
 * environments. A user can pin the name explicitly via `build_config.bucket_name`
 * instead of the slug default.
 *
 * State is machine-managed JSON (never user-edited): a malformed or unreadable
 * file is treated as empty and reparsed/regenerated — the slug cache is a
 * convenience, not a source of truth.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const STATE_PATH = join('.ycsf', 'state.json');
const SLUG_LENGTH = 8; // 4 random bytes → 8 hex chars

interface BucketSlugsState {
  version: 1;
  bucketSlugs: Record<string, string>;
}

function loadState(projectRoot: string): BucketSlugsState {
  const file = join(projectRoot, STATE_PATH);
  if (!existsSync(file)) return { version: 1, bucketSlugs: {} };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<BucketSlugsState>;
    if (
      parsed.version === 1 &&
      parsed.bucketSlugs !== null &&
      typeof parsed.bucketSlugs === 'object' &&
      !Array.isArray(parsed.bucketSlugs)
    ) {
      return { version: 1, bucketSlugs: parsed.bucketSlugs as Record<string, string> };
    }
  } catch {
    // unreadable/corrupt → regenerate below
  }
  return { version: 1, bucketSlugs: {} };
}

function persistState(projectRoot: string, state: BucketSlugsState): void {
  const file = join(projectRoot, STATE_PATH);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

export interface BucketName {
  readonly bucketName: string;
  readonly explicit: boolean;
}

export function bucketNameFor(
  projectRoot: string,
  appId: string,
  configured?: string,
): BucketName {
  if (configured !== undefined) {
    return { bucketName: configured, explicit: true };
  }
  const state = loadState(projectRoot);
  let slug = state.bucketSlugs[appId];
  if (slug === undefined) {
    slug = randomBytes(SLUG_LENGTH / 2).toString('hex');
    state.bucketSlugs[appId] = slug;
    persistState(projectRoot, state);
  }
  return { bucketName: `${appId}-${slug}`, explicit: false };
}