import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { extractOpenApi } from '../src/index.js';

const { spawnCalls } = vi.hoisted(() => ({ spawnCalls: [] as unknown[] }));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: ((...args: Parameters<typeof actual.spawn>) => {
      spawnCalls.push(args);
      return actual.spawn(...args);
    }) as typeof actual.spawn,
  };
});

const SAFE_ENTRY_ROOT = fileURLToPath(new URL('./fixtures/app-safe-entry/', import.meta.url));
const SAFE_ENTRY = 'src/openapi.entry.js';
const EXPECTED_SAFE = JSON.parse(readFileSync(join(SAFE_ENTRY_ROOT, 'expected.json'), 'utf8'));

const ARTIFACT_ROOT = fileURLToPath(new URL('./fixtures/app-artifact/', import.meta.url));
const BOTH_ROOT = fileURLToPath(new URL('./fixtures/app-artifact-both/', import.meta.url));
const BROKEN_ROOT = fileURLToPath(new URL('./fixtures/app-broken-artifact/', import.meta.url));

const CONVENTION_ROOT = fileURLToPath(new URL('./fixtures/app-convention/', import.meta.url));
const EXPECTED_CONVENTION = JSON.parse(
  readFileSync(join(CONVENTION_ROOT, 'expected.json'), 'utf8'),
);

const NOTHING_ROOT = fileURLToPath(new URL('./fixtures/app-nothing/', import.meta.url));
const BROKEN_CONVENTION_ROOT = fileURLToPath(
  new URL('./fixtures/app-convention-broken/', import.meta.url),
);

describe('extractOpenApi.success', () => {
  it('openapi_entry (explicit) resolves with the document unchanged (US1/AC1, FR-009 parity)', async () => {
    const doc = await extractOpenApi({ appRoot: SAFE_ENTRY_ROOT, openapiEntry: SAFE_ENTRY });
    expect(doc).toEqual(EXPECTED_SAFE);
  });

  it('openapi_entry sees SERVERLESS_TOOLS_OPENAPI_BUILD=1 inside the runner (US1/AC3, FR-002)', async () => {
    const doc = await extractOpenApi({ appRoot: SAFE_ENTRY_ROOT, openapiEntry: SAFE_ENTRY });
    expect(doc['x-yc-env-observed']).toBe('1');
  });

  it('never initializes the overflowing provider module (US1/AC1, SC-002 safe mode)', async () => {
    const marker = join(SAFE_ENTRY_ROOT, 'init-ran.marker');
    rmSync(marker, { force: true });
    await extractOpenApi({ appRoot: SAFE_ENTRY_ROOT, openapiEntry: SAFE_ENTRY });
    expect(existsSync(marker)).toBe(false);
  });
});

describe('extractOpenApi.artifact', () => {
  it('artifact fallback: swagger.json is used when no entry is given (US2/AC1, FR-004)', async () => {
    const doc = await extractOpenApi({ appRoot: ARTIFACT_ROOT });
    const expected = JSON.parse(readFileSync(join(ARTIFACT_ROOT, 'swagger.json'), 'utf8'));
    expect(doc).toEqual(expected);
  });

  it('artifact fallback: swagger.json wins over openapi.json when both exist (US2/AC2)', async () => {
    const doc = await extractOpenApi({ appRoot: BOTH_ROOT });
    expect(doc['info']).toEqual({ title: 'artifact-swagger', version: '1.0.0' });
  });

  it('artifact fallback: NO child node process is spawned (US2/AC1 — user code never executed)', async () => {
    spawnCalls.length = 0;
    await extractOpenApi({ appRoot: ARTIFACT_ROOT });
    expect(spawnCalls).toHaveLength(0);
  });

  it('broken swagger.json → INVALID_ARTIFACT, never falls through to openapi.json (US2/AC3, FR-007)', async () => {
    await expect(extractOpenApi({ appRoot: BROKEN_ROOT })).rejects.toMatchObject({
      code: 'INVALID_ARTIFACT',
      sourcePath: join(BROKEN_ROOT, 'swagger.json'),
    });
  });
});

describe('extractOpenApi.convention', () => {
  it('dist/main convention is used when no entry/artifacts exist (US3/AC1, FR-005)', async () => {
    const doc = await extractOpenApi({ appRoot: CONVENTION_ROOT });
    expect(doc).toEqual(EXPECTED_CONVENTION);
  });

  it('dist/main sees SERVERLESS_TOOLS_OPENAPI_BUILD=1 inside the runner (US3/AC1, FR-002)', async () => {
    const doc = await extractOpenApi({ appRoot: CONVENTION_ROOT });
    expect(doc['x-yc-env-observed']).toBe('1');
  });
});

describe('extractOpenApi.errors', () => {
  it('no source at all → NO_SOURCE with the fixed terminal message (US4/AC1, FR-006)', async () => {
    await expect(extractOpenApi({ appRoot: NOTHING_ROOT })).rejects.toMatchObject({
      code: 'NO_SOURCE',
      message: 'Specify openapi_entry in build_config.yaml or export buildYcsfOpenApi from your entry point.',
    });
  });

  it('dist/main exists but lacks buildYcsfOpenApi → ENTRY_LOAD_FAILED, fail-fast (US3/AC2, FR-008)', async () => {
    await expect(extractOpenApi({ appRoot: BROKEN_CONVENTION_ROOT })).rejects.toMatchObject({
      code: 'ENTRY_LOAD_FAILED',
    });
  });
});