import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// FR-002/D-5a: @ycforge/builders-core is a standalone builder package — no
// import of the pilot runtime anywhere in src (a zero-dependency mirror).
// Only import STATEMENTS are forbidden; doc-comment provenance mentions of
// the pilot contracts are allowed (they pin the structural contract).

const SRC_DIR = fileURLToPath(new URL('../../src', import.meta.url));
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

describe('src is pilot-free (FR-002, D-5a)', () => {
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
});