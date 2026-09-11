import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Host-loader E2E (T120/T121): proves the dev server works when spawned as a
// plain node process — never under vitest's own transpiler. (a) TS entry loads
// with `node --import tsx`; (b) plain node cannot load a TS entry and the host
// loader fails open with JDT_ENTRY_RESOLVE_FAILED; (c) a CJS entry class loads
// with Node interop even under the loader. Ref: A-2, FR-005, quickstart Sc10.

const PKG_ROOT = process.cwd();
const DIST_SERVER = join(PKG_ROOT, 'dist', 'server', 'index.js');
const TS_ENTRY = join(PKG_ROOT, 'test', 'fixtures', 'user-service', 'app.module.ts');
const CJS_ENTRY = join(PKG_ROOT, 'test', 'fixtures', 'user-service', 'cjs-entry.cjs');

const RUNNER = `
import { createYcsfLocalServer } from ${JSON.stringify(`file://${DIST_SERVER}`)};
const entry = process.argv[2];
try {
  const s = await createYcsfLocalServer({ entry, port: 0 });
  const res = await fetch(s.baseUrl + '/api/users');
  console.log('STATUS=' + res.status);
  console.log('BASE=' + s.baseUrl);
  await s.stop();
  process.exit(0);
} catch (error) {
  console.error('FAILED_CODE=' + (error && typeof error === 'object' ? error.code ?? '' : ''));
  console.error('FAILED_NAME=' + (error && typeof error === 'object' ? error.name ?? '' : ''));
  console.error('CAUSE=' + (error && typeof error === 'object' && error.cause && typeof error.cause === 'object'
    ? String(error.cause.message ?? '')
    : ''));
  process.exit(1);
}
`;

let tmpDir: string;

function writeRunnerFile(): string {
  tmpDir = mkdtempSync(join(tmpdir(), 'jdt-host-loader-'));
  const file = join(tmpDir, 'runner.mjs');
  writeFileSync(file, RUNNER, 'utf8');
  return file;
}

function cleanup(): void {
  rmSync(tmpDir, { recursive: true, force: true });
}

describe('host-loader e2e (T120/T121, A-2)', () => {
  it('loads a TS entry and serves requests under `node --import tsx`', () => {
    const runner = writeRunnerFile();
    try {
      const result = spawnSync('node', ['--import', 'tsx', runner, TS_ENTRY], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/STATUS=200/);
      expect(result.stdout).toMatch(/BASE=http:\/\/127\.0\.0\.1:\d+/);
    } finally {
      cleanup();
    }
  });

  it('rejects a TS entry under plain node without a loader (JDT_ENTRY_RESOLVE_FAILED)', () => {
    const runner = writeRunnerFile();
    try {
      const result = spawnSync('node', [runner, TS_ENTRY], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(result.status).not.toBe(0);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output).toMatch(/FAILED_NAME=LocalDevServerError/);
      expect(output).toMatch(/FAILED_CODE=JDT_ENTRY_RESOLVE_FAILED/);
      expect(output).toMatch(/CAUSE=.+/);
    } finally {
      cleanup();
    }
  });

  it('loads a CommonJS entry class with Node interop', () => {
    const runner = writeRunnerFile();
    try {
      const result = spawnSync('node', ['--import', 'tsx', runner, CJS_ENTRY], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/STATUS=\d+/);
    } finally {
      cleanup();
    }
  });
});