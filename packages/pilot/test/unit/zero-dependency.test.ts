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

  it('the @ycforge/pilot/contracts subpath never references a declared runtime dependency', () => {
    const pkg = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    // The pilot ROOT package now carries runtime deps (yaml@^2) for the
    // src/model parser (spec 011). That must never leak into the contracts
    // subpath: this assertion is scoped to the contracts import graph, so the
    // root dep list staying non-empty is fine — using any of it in
    // src/contracts is not.
    const runtimeDeps = Object.keys(
      (pkg.dependencies as Record<string, string> | undefined) ?? {},
    );
    const offenders: string[] = [];
    for (const file of walk(contractsDir)) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(IMPORT_RE)) {
        const specifier = match[1] ?? '';
        if (runtimeDeps.some((dep) => specifier === dep || specifier.startsWith(`${dep}/`))) {
          offenders.push(`${relative(packageRoot, file)}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
    expect(pkg).not.toHaveProperty('peerDependencies');
  });
});
