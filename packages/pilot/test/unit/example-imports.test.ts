import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// SC-003 / US1 Independent Test: the reference third-party plugin must import
// ONLY from '@ycforge/pilot/contracts'. Compilation alone would not catch a
// relative import into packages/pilot/src — this guard fails on it.

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const exampleSrcDir = join(repoRoot, 'examples', 'third-party-contracts-plugin', 'src');

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

const IMPORT_RE = /^\s*import\s[^'"]*['"]([^'"]+)['"]/gm;

describe('example plugin imports only @ycforge/pilot/contracts (SC-003)', () => {
  it('every import specifier in examples/third-party-contracts-plugin/src resolves to the contracts subpath', () => {
    const offenders: string[] = [];
    for (const file of walk(exampleSrcDir)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(IMPORT_RE)) {
        const specifier = match[1] ?? '';
        if (specifier !== '@ycforge/pilot/contracts') {
          offenders.push(`${relative(repoRoot, file)}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
