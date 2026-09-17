import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// FR-002/D-2: materializers-core is a standalone package — no import of the
// pilot runtime anywhere in src (structural replicas instead, Constitution I).
// Only import STATEMENTS are forbidden; doc-comment provenance mentions of
// the pilot contracts are allowed (they pin the structural conformance).

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));
const PKG_JSON = fileURLToPath(new URL('../../package.json', import.meta.url));
const PILOT_IMPORT = /(?:from\s*|import\s*\(\s*)['"]@ycforge\/pilot(\/|['"])/;

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (entry.endsWith('.ts')) {
      yield full;
    }
  }
}

describe('src is pilot-free (FR-002, Constitution I)', () => {
  it('no source file imports @ycforge/pilot', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_DIR)) {
      const text = readFileSync(file, 'utf8');
      if (PILOT_IMPORT.test(text)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('package.json declares no @ycforge/pilot dependency in any section', () => {
    const pkg = JSON.parse(readFileSync(PKG_JSON, 'utf8')) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
      peerDependencies?: Record<string, unknown>;
    };
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
      if (pkg[section] !== undefined) {
        expect(Object.keys(pkg[section] as Record<string, unknown>)).not.toContain('@ycforge/pilot');
      }
    }
  });
});