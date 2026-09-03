import { existsSync, readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CONTRACT_VERSION } from '../../src/contracts/index.js';

// SC-005 / FR-017 / FR-018: CONTRACT_VERSION equals the semver major of the
// @ycforge/pilot package (single plugin-API line). The `.ycsf/*.yaml` format
// line (`version: 1`) is versioned independently (clarification 2026-09-03).

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

describe('CONTRACT_VERSION', () => {
  it('is exported and equals 1 (version: 1 contract line)', () => {
    expect(CONTRACT_VERSION).toBe(1);
  });

  it('SC-005: matches the semver major of the package', () => {
    const [major] = readPackageVersion().split('.');
    expect(CONTRACT_VERSION).toBe(Number(major));
  });

  it('SC-005: a migration guide exists for every major > 1 (process rule)', () => {
    if (CONTRACT_VERSION > 1) {
      expect(existsSync(new URL('../../MIGRATION.md', import.meta.url))).toBe(true);
    } else {
      // v1: no migration guide required; the rule is pinned for >= 2.
      expect(CONTRACT_VERSION).toBe(1);
    }
  });
});
