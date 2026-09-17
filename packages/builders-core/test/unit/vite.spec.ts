import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { BuildContext, FrontendArtifactValue } from '../../src/types.js';
import {
  BLC_BUILD_FAILED,
  BLC_ENV_NOT_RESOLVED,
  BLC_INVALID_CONFIG,
  BLC_MISSING_SOURCE,
} from '../../src/diagnostics.js';
import viteBuilder from '../../src/vite/index.js';
import { makeTempDir, type TempDir } from '../helpers/fixture-project.js';
import { fakeVite, withPath } from '../helpers/fake-bins.js';

function ctx(sourcePath: string, overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    projectRoot: sourcePath,
    sourcePath,
    buildConfig: { out_dir: 'dist', root: '.', command: 'vite build' },
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

describe('vite builder (US2, US5, D-RE-3/10)', () => {
  const dirs: TempDir[] = [];

  afterEach(() => {
    for (const d of dirs) {
      d.remove();
    }
    dirs.length = 0;
  });

  it('D-RE-3 happy path: runs `vite build` in the project, artifact directory = outputDir (Sc5)', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    const binDir = join(fixture.root, 'node_modules', '.bin');
    const { logFile } = fakeVite(binDir, { captureEnv: [] });
    const artifact = await viteBuilder.build(ctx(fixture.root));
    expect(artifact.type).toBe('ycforge:frontend');
    const value = artifact.value as FrontendArtifactValue;
    expect(value.directory).toBe(join(fixture.root, 'build-out'));
    expect(existsSync(join(value.directory, 'index.html'))).toBe(true);
    const args = readFileSync(logFile, 'utf8').split('\n').filter((l) => l.length > 0);
    expect(args).toContain('ARG build');
    expect(args).toContain(`PWD ${realpathSync(fixture.root)}`);
  });

  it('US3-AC2 empty build_config → defaults applied (out_dir=dist, root=.), artifact created (Sc6)', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    const binDir = join(fixture.root, 'node_modules', '.bin');
    fakeVite(binDir, { captureEnv: [] });
    const artifact = await viteBuilder.build(ctx(fixture.root, { buildConfig: {} }));
    expect(artifact.type).toBe('ycforge:frontend');
    const value = artifact.value as FrontendArtifactValue;
    expect(value.directory).toBe(join(fixture.root, 'build-out'));
    expect(existsSync(join(value.directory, 'index.html'))).toBe(true);
  });

  it('command override: extra flags reach the CLI as extra argv tokens', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    const binDir = join(fixture.root, 'node_modules', '.bin');
    const { logFile } = fakeVite(binDir, { captureEnv: [] });
    await viteBuilder.build(
      ctx(fixture.root, { buildConfig: { command: 'vite build --mode staging' } }),
    );
    const args = readFileSync(logFile, 'utf8').split('\n').filter((l) => l.length > 0);
    expect(args).toContain('ARG --mode');
    expect(args).toContain('ARG staging');
  });

  it('D-RE-10: app-local vite bin shadows an earlier-lying fake vite on PATH', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    const appBin = join(fixture.root, 'node_modules', '.bin');
    const appLog = fakeVite(appBin, { captureEnv: [] }).logFile;
    const evil = makeTempDir('bc-evil-');
    dirs.push(evil);
    const evilBin = join(evil.root, 'bin');
    const evilLog = fakeVite(evilBin, {
      captureEnv: [],
      exitCode: 1,
      failMessage: 'evil vite ran',
    }).logFile;
    await withPath(evilBin, async () => {
      const artifact = await viteBuilder.build(ctx(fixture.root));
      expect((artifact.value as FrontendArtifactValue).directory.startsWith(fixture.root)).toBe(true);
    });
    expect(existsSync(evilLog)).toBe(false);
    expect(existsSync(appLog)).toBe(true);
  });

  it('buildEnv values are injected into the build and observable in dist (D-RE-9), command never uses npx', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    const binDir = join(fixture.root, 'node_modules', '.bin');
    const { logFile } = fakeVite(binDir, { captureEnv: ['YANDEX_ID_APP_ID', 'GREETING'] });
    const outputDir = join(fixture.root, 'build-out');
    await viteBuilder.build(
      ctx(fixture.root, {
        buildEnv: { YANDEX_ID_APP_ID: 'appid-123', GREETING: 'privet' },
        outputDir,
      }),
    );
    const envFile = readFileSync(join(outputDir, 'env.txt'), 'utf8');
    expect(envFile).toContain('YANDEX_ID_APP_ID=appid-123');
    expect(envFile).toContain('GREETING=privet');
    const log = readFileSync(logFile, 'utf8').split('\n').filter((l) => l.length > 0);
    expect(log).toContain('ENV YANDEX_ID_APP_ID=appid-123');
    expect(log).not.toContain('ARG npx');
  });

  it('BLC_BUILD_FAILED: nonzero command exit → message carries the stderr tail', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    const binDir = join(fixture.root, 'node_modules', '.bin');
    fakeVite(binDir, { captureEnv: [], exitCode: 1, failMessage: 'vite crashed on staging' });
    const err = await expectBLC(viteBuilder.build(ctx(fixture.root)), BLC_BUILD_FAILED);
    expect(err.message).toContain('vite crashed on staging');
  });

  it('BLC_BUILD_FAILED: command succeeded but out_dir missing (no dist produced)', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    const binDir = join(fixture.root, 'node_modules', '.bin');
    fakeVite(binDir, { captureEnv: [], createDist: false });
    const err = await expectBLC(viteBuilder.build(ctx(fixture.root)), BLC_BUILD_FAILED);
    expect(err.message).toContain('dist');
  });

  it('BLC_MISSING_SOURCE: sourcePath absent (DQ-2)', async () => {
    await expectBLC(
      viteBuilder.build({
        projectRoot: '.',
        buildConfig: {},
        buildEnv: {},
        outputDir: join('.', 'out'),
      } as BuildContext),
      BLC_MISSING_SOURCE,
    );
  });

  it('BLC_ENV_NOT_RESOLVED: residual {{$MODE}} in command (US5-AC1/Sc8) runs before any child process', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    const binDir = join(fixture.root, 'node_modules', '.bin');
    const { logFile } = fakeVite(binDir, { captureEnv: [] });
    const err = await expectBLC(
      viteBuilder.build(ctx(fixture.root, { buildConfig: { command: 'vite build {{$MODE}}' } })),
      BLC_ENV_NOT_RESOLVED,
    );
    expect(err.message).toContain('command');
    expect(existsSync(logFile)).toBe(false);
  });

  it('BLC_INVALID_CONFIG: out_dir not a string (non-string known field)', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    await expectBLC(
      viteBuilder.build(ctx(fixture.root, { buildConfig: { out_dir: 123 } })),
      BLC_INVALID_CONFIG,
    );
  });

  it('unknown top-level key ignored; build succeeds', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    const binDir = join(fixture.root, 'node_modules', '.bin');
    fakeVite(binDir, { captureEnv: [] });
    const artifact = await viteBuilder.build(
      ctx(fixture.root, { buildConfig: { base_path: '/api' } }),
    );
    expect(artifact.type).toBe('ycforge:frontend');
  });

  it('bucket_name override flows into FrontendArtifactValue.bucketName (spec 035)', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    const binDir = join(fixture.root, 'node_modules', '.bin');
    fakeVite(binDir, { captureEnv: [] });
    const artifact = await viteBuilder.build(
      ctx(fixture.root, { buildConfig: { bucket_name: 'frontend-my-deploy' } }),
    );
    const value = artifact.value as FrontendArtifactValue;
    expect(value.bucketName).toBe('frontend-my-deploy');
  });

  it('absent bucket_name → appId slug default, persisted in .ycsf/state.json and reused (spec 035)', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    const binDir = join(fixture.root, 'node_modules', '.bin');
    fakeVite(binDir, { captureEnv: [] });
    const outputDir = join(fixture.root, '.ycsf', 'artifacts', 'frontend');

    const first = await viteBuilder.build(ctx(fixture.root, { outputDir }));
    const value1 = first.value as FrontendArtifactValue;
    expect(value1.bucketName).toBeDefined();
    expect(value1.bucketName).toMatch(/^frontend-[0-9a-f]{8}$/);

    const stateFile = join(fixture.root, '.ycsf', 'state.json');
    expect(existsSync(stateFile)).toBe(true);
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as {
      version: number;
      bucketSlugs: Record<string, string>;
    };
    expect(state.version).toBe(1);
    expect(state.bucketSlugs.frontend).toBe(value1.bucketName?.replace(/^frontend-/, ''));

    const second = await viteBuilder.build(ctx(fixture.root, { outputDir }));
    const value2 = second.value as FrontendArtifactValue;
    expect(value2.bucketName).toBe(value1.bucketName);
  });

  it('BLC_INVALID_CONFIG: bucket_name not a string', async () => {
    const fixture = makeTempDir('bc-vite-');
    dirs.push(fixture);
    await expectBLC(
      viteBuilder.build(ctx(fixture.root, { buildConfig: { bucket_name: 42 } })),
      BLC_INVALID_CONFIG,
    );
  });
});