import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileComposition, type CompileSource } from '../src/compile-core.js';

// The runner spawn must be observable so we can prove that an explicit
// openapi_entry loads the artifact file WITHOUT ever spawning the runner.
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

// DURING-observer for the env-safe-mode scope: compileComposition must set
// SERVERLESS_TOOLS_OPENAPI_BUILD='1' only for the duration of the call.
const { buildResourceIndexCalls } = vi.hoisted(() => ({
  buildResourceIndexCalls: [] as Array<string | undefined>,
}));

vi.mock('../src/cli/resource-index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cli/resource-index.js')>();
  return {
    ...actual,
    buildResourceIndex: (async (projectRoot: string) => {
      buildResourceIndexCalls.push(process.env.SERVERLESS_TOOLS_OPENAPI_BUILD);
      return actual.buildResourceIndex(projectRoot);
    }) as typeof actual.buildResourceIndex,
  };
});

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CLI_PASS = join(FIXTURES, 'cli-pass');
const APP_DIR = join(CLI_PASS, 'apps', 'user_service');

const RESOURCES_YAML = `version: 1
functions:
  authorizer_fn: {}
`;

const AUTH_YAML = `version: 1
defaultScheme: authorizer
schemes:
  authorizer:
    type: function
    function: functions.authorizer_fn
`;

const CONVENTION_JS = `export function buildYcsfOpenApi() {
  return {
    openapi: "3.0.0",
    info: { title: "convention-title", version: "1.0.0" },
    paths: { "/convention": { get: { operationId: "conv", responses: { 200: { description: "ok" } } } } },
  };
}
`;

async function withTempProject(
  files: Record<string, string>,
  run: (root: string, appDir: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'compile-core-'));
  try {
    const appDir = join(root, 'app');
    await mkdir(appDir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(root, rel);
      await mkdir(abs.replace(/\/[^/]+$/, ''), { recursive: true });
      await writeFile(abs, content, 'utf8');
    }
    await run(root, appDir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('compileComposition — determinism + env-safe-mode scope (T011)', () => {
  it('two calls on the same input produce byte-equal JSON (SC-005/A-6)', async () => {
    const source: CompileSource = {
      appId: 'user_service',
      appName: 'User Service',
      appDir: APP_DIR,
      openapiEntry: './openapi.json',
    };
    const [a, b] = await Promise.all([
      compileComposition(source, CLI_PASS),
      compileComposition(source, CLI_PASS),
    ]);
    expect(JSON.stringify(a.document)).toBe(JSON.stringify(b.document));
    expect(a.provenance.size).toBeGreaterThan(0);
  });

  it('SERVERLESS_TOOLS_OPENAPI_BUILD="1" during the call and restored afterwards (FR-007/D-5)', async () => {
    const previous = process.env.SERVERLESS_TOOLS_OPENAPI_BUILD;
    delete process.env.SERVERLESS_TOOLS_OPENAPI_BUILD;
    try {
      buildResourceIndexCalls.length = 0;
      const source: CompileSource = {
        appId: 'user_service',
        appName: 'User Service',
        appDir: APP_DIR,
        openapiEntry: './openapi.json',
      };
      await compileComposition(source, CLI_PASS);
      expect(buildResourceIndexCalls).toEqual(['1']);
      expect(process.env.SERVERLESS_TOOLS_OPENAPI_BUILD).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.SERVERLESS_TOOLS_OPENAPI_BUILD;
      } else {
        process.env.SERVERLESS_TOOLS_OPENAPI_BUILD = previous;
      }
    }
  });

  it('importing the module does NOT set the env globally (unlike cli/compile.ts:18)', () => {
    expect(process.env.SERVERLESS_TOOLS_OPENAPI_BUILD).toBeUndefined();
  });
});

describe('compileComposition — entry priority, 006 fallback, fail-fast (T012)', () => {
  it('(a) explicit openapiEntry loads the json artifact without spawning the runner', async () => {
    spawnCalls.length = 0;
    const source: CompileSource = {
      appId: 'user_service',
      appName: 'User Service',
      appDir: APP_DIR,
      openapiEntry: './openapi.json',
    };
    const { document } = await compileComposition(source, CLI_PASS);
    expect(document.info).toMatchObject({ title: 'User Service' });
    expect(spawnCalls).toHaveLength(0);
  });

  it('(b1) no entry → 006 fallback auto-detect openapi.json in appDir (no runner)', async () => {
    spawnCalls.length = 0;
    const source: CompileSource = { appId: 'user_service', appName: 'User Service', appDir: APP_DIR };
    const { document } = await compileComposition(source, CLI_PASS);
    expect(document.info).toMatchObject({ title: 'User Service' });
    expect(spawnCalls).toHaveLength(0);
  });

  it('(b2) no entry/artifact → dist/main convention via the runner', async () => {
    spawnCalls.length = 0;
    await withTempProject(
      {
        '.ycsf/resources.yaml': RESOURCES_YAML,
        'app/build_config.yaml': 'version: 1\n',
        'app/auth.yaml': AUTH_YAML,
        'app/dist/main.js': CONVENTION_JS,
      },
      async (root, appDir) => {
        const source: CompileSource = { appId: 'test', appName: 'test', appDir };
        const { document } = await compileComposition(source, root);
        expect(document.info).toMatchObject({ title: 'convention-title' });
        expect(spawnCalls.length).toBeGreaterThan(0);
      },
    );
  });

  it('(c) no source at all → NO_SOURCE fail-fast (never silent)', async () => {
    await withTempProject(
      {
        '.ycsf/resources.yaml': RESOURCES_YAML,
        'app/build_config.yaml': 'version: 1\n',
        'app/auth.yaml': AUTH_YAML,
      },
      async (root, appDir) => {
        const source: CompileSource = { appId: 'test', appName: 'test', appDir };
        await expect(compileComposition(source, root)).rejects.toMatchObject({
          name: 'OpenApiExtractError',
          code: 'NO_SOURCE',
        });
      },
    );
  });

  it('(d) env.yaml mode=env-only → placeholder document with paths:{} and info.title=appName', async () => {
    await withTempProject(
      {
        '.ycsf/resources.yaml': RESOURCES_YAML,
        '.ycsf/env.yaml': 'version: 1\nmode: env-only\n',
        'app/auth.yaml': AUTH_YAML,
      },
      async (root, appDir) => {
        const source: CompileSource = { appId: 'envapp', appName: 'Env App', appDir };
        const { document } = await compileComposition(source, root);
        expect(document.paths).toEqual({});
        expect(document.info).toMatchObject({ title: 'Env App', version: '0.0.0' });
      },
    );
  });

  it('(d2) env-only auto-detected from resources (envOnly not passed)', async () => {
    await withTempProject(
      {
        '.ycsf/resources.yaml': RESOURCES_YAML,
        '.ycsf/env.yaml': 'version: 1\nmode: env-only\n',
        'app/auth.yaml': AUTH_YAML,
      },
      async (root, appDir) => {
        const source: CompileSource = { appId: 'envapp', appName: 'Env App', appDir };
        const { document } = await compileComposition(source, root);
        expect(document.paths).toEqual({});
        expect(document.info).toMatchObject({ title: 'Env App' });
      },
    );
  });
});