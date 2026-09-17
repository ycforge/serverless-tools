import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildApps } from '@ycforge/pilot';

// FR-015 / A-7: the ycforge:api-gateway artifact survives a pilot blob-cache
// round-trip (spec 022). Two buildApps runs over the same unchanged project:
// the second must HIT the cache and restore the artifact (value.specPath stays
// a valid absolute path into `.ycsf/artifacts/openapi/openapi.json`).

const COMPOSER_DIR = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/builder-openapi', import.meta.url));

async function createTempProject(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'ycsf-cache-roundtrip-'));
  cpSync(FIXTURE_DIR, root, { recursive: true });
  mkdirSync(join(root, 'openapi'), { recursive: true });
  writeFileSync(
    join(root, 'openapi', 'build_config.yaml'),
    readFileSync(join(FIXTURE_DIR, 'apps', 'openapi', 'build_config.yaml'), 'utf8'),
  );
  writeFileSync(
    join(root, '.ycsf', 'builders.yaml'),
    `version: 1
builders:
  "ycforge:api-gateway": "${join(COMPOSER_DIR, 'dist', 'builder', 'index.js')}"
`,
  );
  return root;
}

describe('builder blob-cache round-trip (spec 026, P4 / T045): FR-015 + A-7', () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempProject();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('second buildApps run restores the artifact from the blob cache (same root)', async () => {
    const first = await buildApps(root);
    expect(first.kind).toBe('ok');
    if (first.kind !== 'ok') return;
    expect(first.cache!.hits).toBe(0);
    expect(first.cache!.misses).toBe(1);
    const firstArtifact = first.artifacts[0]!.artifact;
    expect(firstArtifact.type).toBe('ycforge:api-gateway');
    const firstValue = firstArtifact.value as { specPath: string; resourceReferences: unknown };

    // second run over unchanged sources → cache hit, artifact restored
    const second = await buildApps(root);
    expect(second.kind).toBe('ok');
    if (second.kind !== 'ok') return;
    expect(second.cache!.hits).toBe(1);
    expect(second.cache!.misses).toBe(0);

    const restored = second.artifacts[0]!.artifact;
    expect(restored.type).toBe('ycforge:api-gateway');
    const restoredValue = restored.value as { specPath: string; resourceReferences: unknown };

    // value survives the round-trip: same absolute specPath, same references
    expect(restoredValue.specPath).toBe(firstValue.specPath);
    expect(restoredValue.resourceReferences).toEqual(firstValue.resourceReferences);

    // and the restored specPath still resolves to a parseable document
    expect(existsSync(restoredValue.specPath)).toBe(true);
    const document = JSON.parse(readFileSync(restoredValue.specPath, 'utf8'));
    expect(document.openapi).toBeDefined();
    expect(document.paths['/v1/hello']).toBeDefined();
  });
});