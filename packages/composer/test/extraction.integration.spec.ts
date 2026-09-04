import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { extractOpenApi } from '../src/index.js';

const SAFE_ENTRY_ROOT = fileURLToPath(new URL('./fixtures/app-safe-entry/', import.meta.url));
const SAFE_ENTRY = 'src/openapi.entry.js';
const EXPECTED_SAFE = JSON.parse(readFileSync(join(SAFE_ENTRY_ROOT, 'expected.json'), 'utf8'));

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