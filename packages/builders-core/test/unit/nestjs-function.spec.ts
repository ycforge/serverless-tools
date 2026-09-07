import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { BuildContext, FunctionArtifactValue } from '../../src/types.js';
import {
  BLC_ARCHIVE_FAILED,
  BLC_ENV_NOT_RESOLVED,
  BLC_ENTRY_NOT_FOUND,
  BLC_INVALID_CONFIG,
  BLC_MISSING_SOURCE,
} from '../../src/diagnostics.js';
import nestjsFunctionBuilder from '../../src/nestjs-function/index.js';
import { nestjsFixture, unzipEntry, unzipTest, type TempDir } from '../helpers/fixture-project.js';

function ctx(sourcePath: string, overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    projectRoot: sourcePath,
    sourcePath,
    buildConfig: { entry: 'src/main.ts', runtime: 'nodejs20', external: [] },
    buildEnv: {},
    outputDir: join(sourcePath, 'build-out'),
    ...overrides,
  };
}

async function expectBLC(promise: Promise<unknown>, code: string): Promise<Error & { code: string }> {
  try {
    await promise;
  } catch (err) {
    const e = err as { code?: string };
    expect(e.code).toBe(code);
    return err as Error & { code: string };
  }
  throw new Error(`expected BuilderError ${code}, got success`);
}

describe('nestjs-function builder (US1, US5, SC-001/003/006)', () => {
  const dirs: TempDir[] = [];

  afterEach(() => {
    for (const d of dirs) {
      d.remove();
    }
    dirs.length = 0;
  });

  it('US1-AC1 happy path: bundles to a zip in outputDir with entryPoint main.handler (Sc1)', async () => {
    const fixture = nestjsFixture();
    dirs.push(fixture);
    const outputDir = join(fixture.root, 'build-out');
    const artifact = await nestjsFunctionBuilder.build(ctx(fixture.root, { outputDir }));
    expect(artifact.type).toBe('ycforge:function');
    const value = artifact.value as FunctionArtifactValue;
    expect(value.archivePath.startsWith(outputDir)).toBe(true);
    expect(value.archivePath.endsWith('function.zip')).toBe(true);
    expect(value.entryPoint).toBe('main.handler');
    expect(existsSync(value.archivePath)).toBe(true);
  });

  it('SC-003 determinism: two identical builds produce byte-identical zips (same outputDir)', async () => {
    const fixture = nestjsFixture();
    dirs.push(fixture);
    const outputDir = join(fixture.root, 'build-out');
    const buildCtx = ctx(fixture.root, { outputDir });
    const first = (await nestjsFunctionBuilder.build(buildCtx)).value as FunctionArtifactValue;
    const second = (await nestjsFunctionBuilder.build(buildCtx)).value as FunctionArtifactValue;
    expect(readFileSync(first.archivePath).equals(readFileSync(second.archivePath))).toBe(true);
  });

  it('SC-006 self-contained: bundle is CJS with module.exports.handler = function, no unbundled refs (Sc1)', async () => {
    const fixture = nestjsFixture();
    dirs.push(fixture);
    const outputDir = join(fixture.root, 'build-out');
    const artifact = (await nestjsFunctionBuilder.build(ctx(fixture.root, { outputDir })))
      .value as FunctionArtifactValue;
    const bundle = unzipEntry(artifact.archivePath, 'main.js').toString('utf8');
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('module', 'exports', 'require', bundle)(mod, mod.exports, require);
    expect(typeof mod.exports.handler).toBe('function');
    expect(bundle).not.toMatch(/require\(\s*['"][a-z]/);
  });

  it('US1-AC2 external: sharp import stays external, node_modules/sharp copied into the zip (SC-006/Sc2)', async () => {
    const fixture = nestjsFixture({ external: true });
    dirs.push(fixture);
    const outputDir = join(fixture.root, 'build-out');
    const artifact = (await nestjsFunctionBuilder.build(
      ctx(fixture.root, { buildConfig: { entry: 'src/main.ts', runtime: 'nodejs20', external: ['sharp'] }, outputDir }),
    )).value as FunctionArtifactValue;
    const bundle = unzipEntry(artifact.archivePath, 'main.js').toString('utf8');
    expect(bundle).toContain('require("sharp")');
    expect(bundle).not.toContain('SHARP_NATIVE_MARKER');
    const sharpPkg = unzipEntry(artifact.archivePath, 'node_modules/sharp/package.json').toString('utf8');
    expect(sharpPkg).toContain('"name": "sharp"');
    unzipTest(artifact.archivePath);
  });

  it('US1-AC3 unknown top-level key (openapi_entry) ignored; build succeeds (Sc2)', async () => {
    const fixture = nestjsFixture();
    dirs.push(fixture);
    const outputDir = join(fixture.root, 'build-out');
    const artifact = await nestjsFunctionBuilder.build(
      ctx(fixture.root, {
        buildConfig: { entry: 'src/main.ts', runtime: 'nodejs20', external: [], openapi_entry: 'openapi.yaml' },
        outputDir,
      }),
    );
    expect(artifact.type).toBe('ycforge:function');
  });

  it('US1-AC4 nonexistent entry → BLC_ENTRY_NOT_FOUND, no zip created (Sc3)', async () => {
    const fixture = nestjsFixture();
    dirs.push(fixture);
    const outputDir = join(fixture.root, 'build-out');
    const err = await expectBLC(
      nestjsFunctionBuilder.build(ctx(fixture.root, { buildConfig: { entry: 'src/nonexistent.ts' }, outputDir })),
      BLC_ENTRY_NOT_FOUND,
    );
    expect(err.message).toContain('src/nonexistent.ts');
    expect(err.message).toContain(BLC_ENTRY_NOT_FOUND);
    expect(existsSync(join(outputDir, 'function.zip'))).toBe(false);
  });

  it('US5-AC1 residual {{$ENTRY}} → BLC_ENV_NOT_RESOLVED, no zip created (Sc8)', async () => {
    const fixture = nestjsFixture();
    dirs.push(fixture);
    const outputDir = join(fixture.root, 'build-out');
    const err = await expectBLC(
      nestjsFunctionBuilder.build(ctx(fixture.root, { buildConfig: { entry: '{{$ENTRY}}' }, outputDir })),
      BLC_ENV_NOT_RESOLVED,
    );
    expect(err.message).toContain(BLC_ENV_NOT_RESOLVED);
    expect(existsSync(join(outputDir, 'function.zip'))).toBe(false);
  });

  it('external: "string" (non-array) → BLC_INVALID_CONFIG', async () => {
    const fixture = nestjsFixture();
    dirs.push(fixture);
    const err = await expectBLC(
      nestjsFunctionBuilder.build(ctx(fixture.root, { buildConfig: { entry: 'src/main.ts', external: 'sharp' } })),
      BLC_INVALID_CONFIG,
    );
    expect(err.message).toContain('external');
  });

  it('runtime: "nodejs16" → BLC_INVALID_CONFIG (DQ-3 closed runtime set)', async () => {
    const fixture = nestjsFixture();
    dirs.push(fixture);
    const err = await expectBLC(
      nestjsFunctionBuilder.build(ctx(fixture.root, { buildConfig: { entry: 'src/main.ts', runtime: 'nodejs16' } })),
      BLC_INVALID_CONFIG,
    );
    expect(err.message).toContain('runtime');
  });

  it('out_filename with path separators → BLC_INVALID_CONFIG', async () => {
    const fixture = nestjsFixture();
    dirs.push(fixture);
    await expectBLC(
      nestjsFunctionBuilder.build(
        ctx(fixture.root, { buildConfig: { entry: 'src/main.ts', out_filename: 'sub/function.zip' } }),
      ),
      BLC_INVALID_CONFIG,
    );
  });

  it('missing sourcePath → BLC_MISSING_SOURCE (DQ-2)', async () => {
    const fixture = nestjsFixture();
    dirs.push(fixture);
    const noSource: BuildContext = {
      projectRoot: fixture.root,
      buildConfig: { entry: 'src/main.ts', runtime: 'nodejs20', external: [] },
      buildEnv: {},
      outputDir: join(fixture.root, 'build-out'),
    };
    await expectBLC(nestjsFunctionBuilder.build(noSource), BLC_MISSING_SOURCE);
  });

  it('nonexistent nested outputDir is created recursively; build succeeds', async () => {
    const fixture = nestjsFixture();
    dirs.push(fixture);
    const outputDir = join(fixture.root, 'deep', 'nested', 'out');
    const artifact = await nestjsFunctionBuilder.build(ctx(fixture.root, { outputDir }));
    expect(existsSync((artifact.value as FunctionArtifactValue).archivePath)).toBe(true);
  });

  it('BLC_ARCHIVE_FAILED when the zip write fails (read-only outputDir)', async () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      expect(true).toBe(true); // read-only dir is ineffective as root; skip
      return;
    }
    const fixture = nestjsFixture();
    dirs.push(fixture);
    const outputDir = join(fixture.root, 'ro-out');
    mkdirSync(outputDir, { recursive: true });
    chmodSync(outputDir, 0o555);
    try {
      const err = await expectBLC(
        nestjsFunctionBuilder.build(ctx(fixture.root, { outputDir })),
        BLC_ARCHIVE_FAILED,
      );
      expect(err.message).toContain(BLC_ARCHIVE_FAILED);
    } finally {
      chmodSync(outputDir, 0o755);
    }
  });
});