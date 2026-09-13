import { basename, join } from 'node:path';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { BuildContext } from '@ycforge/pilot/contracts';

import builder from '../../src/builder/index.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const PROJECT_ROOT = join(FIXTURES, 'builder-openapi');
const SOURCE_PATH = join(PROJECT_ROOT, 'apps', 'openapi');

// fs probe (US-2 AC1): the builder must NEVER open `.ycsf/apps.yaml` — it consumes
// the whole model through BuildContext, not via the project filesystem.
const { readFilePaths } = vi.hoisted(() => ({ readFilePaths: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (async (path: string, ...rest: unknown[]) => {
      readFilePaths.push(path);
      return (actual.readFile as (...args: unknown[]) => Promise<string>)(path, ...rest);
    }) as typeof actual.readFile,
  };
});

// spawn probe (US-2 AC2): an honored openapi_entry must NOT start the runner.
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

const WRAPPER = { build_config: { openapi_entry: './openapi.json' }, build_env: {} };
const EMPTY_WRAPPER = { build_config: {}, build_env: {} };

interface CtxOverrides {
  projectRoot?: string;
  sourcePath?: string;
  buildConfig?: unknown;
  outputDir?: string;
}

async function makeContext(overrides: CtxOverrides = {}): Promise<BuildContext> {
  const outputDir = await mkdtemp(join(tmpdir(), 'builder-openapi-out-'));
  return {
    projectRoot: overrides.projectRoot ?? PROJECT_ROOT,
    sourcePath: overrides.sourcePath ?? SOURCE_PATH,
    buildConfig: overrides.buildConfig ?? WRAPPER,
    buildEnv: {},
    outputDir: overrides.outputDir ?? join(outputDir, 'openapi'),
  };
}

async function withTempProject(
  files: Record<string, string>,
  run: (root: string, appDir: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'builder-proj-'));
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

const RESOURCES_YAML = (body: string): string => `version: 1\n${body}`;
const AUTH_FUNCTION_YAML = `version: 1
defaultScheme: authorizer
schemes:
  authorizer:
    type: function
    function: functions.user_service
`;
const AUTH_JWT_YAML = `version: 1
defaultScheme: auth
schemes:
  auth:
    type: jwt
    jwksUri: https://example.com/jwks
    issuer: https://issuer.example.com
    audience: svc
`;

describe('builder.build — project-model consumption via BuildContext only (T023)', () => {
  it('(a) succeeds on a map-form fixture without ever opening .ycsf/apps.yaml (US-2 AC1)', async () => {
    readFilePaths.length = 0;
    const context = await makeContext();
    const artifact = await builder.build(context);

    expect(artifact.type).toBe('ycforge:api-gateway');
    expect(readFilePaths.every((p) => basename(p) !== 'apps.yaml')).toBe(true);

    const document = JSON.parse(await (await import('node:fs/promises')).readFile(artifact.value.specPath as string, 'utf8'));
    expect(document.info).toMatchObject({ title: 'builder-openapi' });
  });

  it('(b) wrapper openapi_entry wins before the 006 fallback; the runner is not started (US-2 AC2)', async () => {
    spawnCalls.length = 0;
    const context = await makeContext();
    const { value } = await builder.build(context);
    const document = JSON.parse(await (await import('node:fs/promises')).readFile(value.specPath as string, 'utf8'));
    expect(document.info).toMatchObject({ title: 'builder-openapi' });
    expect(document.info.title).not.toBe('builder-openapi-convention');
    expect(spawnCalls).toHaveLength(0);
    expect(value.resourceReferences).toEqual([
      { logical: 'functions.user_service', terraformType: 'yandex_function' },
    ]);
  });

  it('(c1) empty build_config → 006 fallback auto-detects the artifact openapi.json', async () => {
    const context = await makeContext({ buildConfig: EMPTY_WRAPPER });
    const { value } = await builder.build(context);
    const document = JSON.parse(await (await import('node:fs/promises')).readFile(value.specPath as string, 'utf8'));
    expect(document.info).toMatchObject({ title: 'builder-openapi' });
  });

  it('(c2) empty build_config + no artifact → dist/main convention via the runner', async () => {
    await withTempProject(
      {
        '.ycsf/resources.yaml': RESOURCES_YAML('functions:\n  user_service:\n    id: d4e-0001\n'),
        'app/build_config.yaml': 'version: 1\nbuild_config: {}\nbuild_env: {}\n',
        'app/auth.yaml': AUTH_FUNCTION_YAML,
        'app/dist/main.js': `export function buildYcsfOpenApi() {
  return Promise.resolve({
    openapi: '3.0.0',
    info: { title: 'convention-title', version: '1.0.0' },
    paths: {},
    'x-env': process.env.SERVERLESS_TOOLS_OPENAPI_BUILD ?? '<unset>',
  });
}
`,
      },
      async (root, appDir) => {
        const context = await makeContext({
          projectRoot: root,
          sourcePath: appDir,
          buildConfig: EMPTY_WRAPPER,
        });
        const { value } = await builder.build(context);
        const document = JSON.parse(await (await import('node:fs/promises')).readFile(value.specPath as string, 'utf8'));
        expect(document.info).toMatchObject({ title: 'convention-title' });
      },
    );
  });

  it('(d) empty buildConfig {} + no source → NO_SOURCE fail-fast (never silence)', async () => {
    const run = (context: BuildContext) => builder.build(context);
    await withTempProject(
      {
        '.ycsf/resources.yaml': RESOURCES_YAML('functions:\n  user_service:\n    id: d4e-0001\n'),
        'app/build_config.yaml': 'version: 1\nbuild_config: {}\n',
      },
      async (root, appDir) => {
        const context = await makeContext({
          projectRoot: root,
          sourcePath: appDir,
          buildConfig: {},
        });
        await expect(run(context)).rejects.toMatchObject({
          name: 'BuilderError',
          code: 'NO_SOURCE',
        });
      },
    );
  });
});

describe('builder.build — fail-fast contract + artifact (T024)', () => {
  it('(a1) missing sourcePath → SOURCE_PATH_MISSING (no fallback to projectRoot)', async () => {
    const context = await makeContext();
    await expect(builder.build({ ...context, sourcePath: undefined })).rejects.toMatchObject({
      name: 'BuilderError',
      code: 'SOURCE_PATH_MISSING',
    });
  });

  it('(a2) nonexistent sourcePath → SOURCE_PATH_INVALID', async () => {
    const context = await makeContext({ sourcePath: join(PROJECT_ROOT, 'apps', 'nope') });
    await expect(builder.build(context)).rejects.toMatchObject({
      name: 'BuilderError',
      code: 'SOURCE_PATH_INVALID',
    });
  });

  it('(a3) sourcePath pointing at a file → SOURCE_PATH_INVALID', async () => {
    const filePath = join(SOURCE_PATH, 'openapi.json');
    await stat(filePath);
    const context = await makeContext({ sourcePath: filePath });
    await expect(builder.build(context)).rejects.toMatchObject({
      name: 'BuilderError',
      code: 'SOURCE_PATH_INVALID',
    });
  });

  it('(b) non-string openapi_entry → OPENAPI_ENTRY_INVALID fail-fast', async () => {
    const context = await makeContext({ buildConfig: { build_config: { openapi_entry: 42 }, build_env: {} } });
    await expect(builder.build(context)).rejects.toMatchObject({
      name: 'BuilderError',
      code: 'OPENAPI_ENTRY_INVALID',
    });
  });

  it('(c) resourceReferences: exactly the bearer-field refs, de-duplicated, ordered (US-3 / D-7)', async () => {
    const context = await makeContext();
    const { value } = await builder.build(context);
    expect(value.resourceReferences).toEqual([
      { logical: 'functions.user_service', terraformType: 'yandex_function' },
    ]);

    const document = JSON.parse(await (await import('node:fs/promises')).readFile(value.specPath as string, 'utf8'));
    // app overrides.yaml replaced the GET operation summary...
    expect(
      (document.paths['/v1/hello'] as { get: { summary: string } }).get.summary,
    ).toBe('builder-override');
    // ...while the NON-bearer ref in the path-item description is untouched and NOT in resourceReferences
    expect(
      (document.paths['/v1/hello'] as { description: string }).description,
    ).toBe('reads ${resources.buckets.frontend.name}');
  });

  it('(d) reference to an undeclared resource → RESOURCE_REF_NOT_DECLARED fail-fast', async () => {
    await withTempProject(
      {
        '.ycsf/resources.yaml': RESOURCES_YAML('functions:\n  user_service:\n    id: d4e-0001\n'),
        'app/build_config.yaml': 'version: 1\nbuild_config:\n  openapi_entry: ./openapi.json\n',
        'app/auth.yaml': AUTH_JWT_YAML,
        'app/openapi.json': JSON.stringify({
          openapi: '3.0.0',
          info: { title: 'x', version: '1.0.0' },
          paths: {},
          components: {
            securitySchemes: {
              ghost_authorizer: {
                type: 'http',
                scheme: 'bearer',
                'x-yc-apigateway-authorizer': {
                  type: 'function',
                  function_id: '${resources.functions.ghost.id}',
                },
              },
            },
          },
        }),
      },
      async (root, appDir) => {
        const context = await makeContext({ projectRoot: root, sourcePath: appDir });
        await expect(builder.build(context)).rejects.toMatchObject({
          name: 'BuilderError',
          code: 'RESOURCE_REF_NOT_DECLARED',
        });
      },
    );
  });

  it('(e) specPath: absolute, inside outputDir, sorted keys, empty paths:{} is a valid artifact', async () => {
    const context = await makeContext();
    const { value } = await builder.build(context);
    expect(value.specPath).toBe(join(context.outputDir, 'openapi.json'));
    await stat(value.specPath as string);

    const document = JSON.parse(await (await import('node:fs/promises')).readFile(value.specPath as string, 'utf8'));
    expect(document.openapi).toBe('3.0.0');
    const pathsKeys = Object.keys(document.paths);
    expect(pathsKeys).toEqual([...pathsKeys].sort());
    const schemeKeys = Object.keys(document.components.securitySchemes);
    expect(schemeKeys).toEqual([...schemeKeys].sort());

    // edge §8: env-only placeholder → paths:{} is a valid artifact, title = appId
    await withTempProject(
      {
        '.ycsf/resources.yaml': RESOURCES_YAML(''),
        '.ycsf/env.yaml': 'version: 1\nmode: env-only\n',
        'app/build_config.yaml': 'version: 1\nbuild_config: {}\n',
        'app/auth.yaml': AUTH_JWT_YAML,
      },
      async (root, appDir) => {
        const envContext = await makeContext({
          projectRoot: root,
          sourcePath: appDir,
          buildConfig: EMPTY_WRAPPER,
          outputDir: join(context.outputDir, 'out', 'openapi'),
        });
        const envValue = (await builder.build(envContext)).value;
        const envDocument = JSON.parse(
          await (await import('node:fs/promises')).readFile(envValue.specPath as string, 'utf8'),
        );
        expect(envDocument.paths).toEqual({});
        expect(envDocument.info).toMatchObject({ title: 'openapi' });
        expect(envValue.resourceReferences).toEqual([]);
      },
    );
  });
});