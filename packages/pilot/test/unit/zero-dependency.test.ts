import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// SC-001 / FR-019: the contracts module must have zero runtime dependencies —
// its import graph contains only relative imports and type-level constructs.

const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
const contractsDir = join(packageRoot, 'src', 'contracts');

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

describe('contracts module: zero runtime dependencies (SC-001)', () => {
  it('src/contracts imports only relative modules', () => {
    const offenders: string[] = [];
    for (const file of walk(contractsDir)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(IMPORT_RE)) {
        const specifier = match[1] ?? '';
        if (!specifier.startsWith('.')) {
          offenders.push(`${relative(packageRoot, file)}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('package.json declares no runtime dependencies', () => {
    const pkg = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(pkg).not.toHaveProperty('dependencies');
    expect(pkg).not.toHaveProperty('peerDependencies');
  });
});
