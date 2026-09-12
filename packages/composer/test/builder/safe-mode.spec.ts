import { join } from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { BuildContext } from '@ycforge/pilot/contracts';

import builder from '../../src/builder/index.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL('../fixtures/builder-openapi/', import.meta.url));

const AUTH_JWT_YAML = `version: 1
defaultScheme: auth
schemes:
  auth:
    type: jwt
    jwksUri: https://example.com/jwks
    issuer: https://issuer.example.com
    audience: svc
`;

const cleanups: string[] = [];

afterEach(async () => {
  const dirs = cleanups.splice(0);
  for (const dir of dirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'safe-mode-'));
  cleanups.push(root);
  return root;
}

async function makeContext(openapiEntry: string): Promise<BuildContext> {
  const root = await makeTempRoot();
  const appDir = join(root, 'app');
  await mkdir(appDir, { recursive: true });
  await writeFile(join(appDir, 'auth.yaml'), AUTH_JWT_YAML, 'utf8');
  const outputDir = join(root, '.ycsf', 'artifacts', 'openapi');
  return {
    projectRoot: PROJECT_ROOT,
    sourcePath: appDir,
    buildConfig: { build_config: { openapi_entry: openapiEntry }, build_env: {} },
    buildEnv: {},
    outputDir,
  };
}

describe('builder safe-mode (US-4/FR-007/FR-013/D-5)', () => {
  it('(a) user entry runs inside a process with SERVERLESS_TOOLS_OPENAPI_BUILD="1"', async () => {
    const entry = join(FIXTURES, 'runner-entry-env-probe.mjs');
    const context = await makeContext(entry);
    const { value } = await builder.build(context);
    const document = JSON.parse(await (await import('node:fs/promises')).readFile(value.specPath as string, 'utf8'));
    expect(document.info).toMatchObject({ title: 'runner-entry-env-probe-1' });
  });

  it('(b) stdout/stderr markers from the entry never appear in the build output or emitted logs', async () => {
    const entry = join(FIXTURES, 'runner-entry-noisy.mjs');
    const context = await makeContext(entry);
    const { value } = await builder.build(context);
    const text = await (await import('node:fs/promises')).readFile(value.specPath as string, 'utf8');
    expect(text).not.toContain('NOISY-MARKER');
    expect(text).toContain('"runner-entry-noisy"');
  });

  it(
    '(c) a hanging entry → timeout diagnostics, the process is killed, build() rejects (no leak)',
    async () => {
      const entry = join(FIXTURES, 'runner-entry-hang.mjs');
      const context = await makeContext(entry);
      await expect(builder.build(context)).rejects.toMatchObject({
        name: 'BuilderError',
        code: 'OPENAPI_LOAD_ERROR',
        message: expect.stringMatching(/did not complete within \d+ms/i),
      });
    },
    90_000,
  );

  it('(d) user code is never imported in-process: a global mutation in the entry does not leak', async () => {
    const entry = join(FIXTURES, 'runner-entry-global-leak.mjs');
    const context = await makeContext(entry);
    delete (globalThis as Record<string, unknown>)['__YCSF_PARENT_LEAK__'];
    const { value } = await builder.build(context);
    const document = JSON.parse(await (await import('node:fs/promises')).readFile(value.specPath as string, 'utf8'));
    expect(document.info).toMatchObject({ title: 'runner-entry-global-leak' });
    expect((globalThis as Record<string, unknown>)['__YCSF_PARENT_LEAK__']).toBeUndefined();
  });
});