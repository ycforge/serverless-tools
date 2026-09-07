import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { BuildContext, DockerArtifactValue } from '../../src/types.js';
import {
  BLC_BUILD_FAILED,
  BLC_ENV_NOT_RESOLVED,
  BLC_IMAGE_DIGEST_UNAVAILABLE,
  BLC_INVALID_CONFIG,
  BLC_MISSING_SOURCE,
} from '../../src/diagnostics.js';
import dockerBuilder from '../../src/docker/index.js';
import { dockerFixture, makeTempDir, type TempDir } from '../helpers/fixture-project.js';
import { fakeDocker, withPath } from '../helpers/fake-bins.js';

const SHA_256_A = 'a'.repeat(64);

function ctx(sourcePath: string, overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    projectRoot: sourcePath,
    sourcePath,
    buildConfig: { image: { repository: 'test.local/app', tag: 'v1' }, dockerfile: 'Dockerfile' },
    buildEnv: {},
    outputDir: join(sourcePath, 'build-out'),
    ...overrides,
  };
}

function readLogLines(file: string): string[] {
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
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

describe('docker builder (US3, US5, SC-004, DQ-6)', () => {
  const dirs: TempDir[] = [];

  afterEach(() => {
    for (const d of dirs) {
      d.remove();
    }
    dirs.length = 0;
  });

  it('SC-004 happy path: build+push, artifact image is the immutable digest form (FR-011/Sc4)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { digest: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(ctx(fixture.root));
      expect(artifact.type).toBe('ycforge:docker-image');
      expect((artifact.value as DockerArtifactValue).image).toBe(`test.local/app@sha256:${SHA_256_A}`);
    });
    const args = readLogLines(bins.logFile);
    expect(args).toContain('ARG build');
    expect(args).toContain('ARG test.local/app:v1');
    expect(args).toContain(`ARG ${join(fixture.root)}`); // dockerfile context = sourcePath
    const pushIdx = args.indexOf('ARG push');
    expect(pushIdx).toBeGreaterThan(-1);
    expect(args[pushIdx + 1]).toBe('ARG test.local/app:v1');
  });

  it('dockerfile and tag defaults apply: -f Dockerfile, tag not set → :latest', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { digest: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app' } } }));
      expect((artifact.value as DockerArtifactValue).image).toBe(`test.local/app@sha256:${SHA_256_A}`);
    });
    const args = readLogLines(bins.logFile);
    expect(args).toContain('ARG -f');
    expect(args).toContain('ARG Dockerfile');
    expect(args).toContain('ARG test.local/app:latest');
  });

  it('FR-011 fallback: push without digest → docker image inspect recovers digest', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { inspectSha: `sha256:${'b'.repeat(64)}` });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(ctx(fixture.root));
      expect((artifact.value as DockerArtifactValue).image).toBe(`test.local/app@sha256:${'b'.repeat(64)}`);
    });
    const args = readLogLines(bins.logFile);
    expect(args).toContain('ARG image');
    expect(args).toContain('ARG test.local/app:v1');
  });

  it('BLC_IMAGE_DIGEST_UNAVAILABLE: push ok but no digest and no inspect digest (FR-011)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'));
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      await expectBLC(dockerBuilder.build(ctx(fixture.root)), BLC_IMAGE_DIGEST_UNAVAILABLE);
    });
  });

  it('BLC_BUILD_FAILED: nonzero docker build exit, message carries the stderr tail', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { buildExit: 5 });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const err = await expectBLC(dockerBuilder.build(ctx(fixture.root)), BLC_BUILD_FAILED);
      expect(err.message).toContain('fake nonzero build');
    });
  });

  it('BLC_BUILD_FAILED: nonzero docker push exit', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { pushExit: 1 });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const err = await expectBLC(dockerBuilder.build(ctx(fixture.root)), BLC_BUILD_FAILED);
      expect(err.message).toContain('permission to push denied');
    });
  });

  it('DQ-6: stderr tail truncated to ~2000 chars with …(truncated, N chars) marker', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bulk = Array.from({ length: 80 }, (_, i) => `noise line ${i} ${'x'.repeat(40)}\n`).join('');
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { buildExit: 1, buildStderr: bulk });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const err = await expectBLC(dockerBuilder.build(ctx(fixture.root)), BLC_BUILD_FAILED);
      const tail = bulk.slice(-30);
      expect(err.message).toContain(tail);
      expect(err.message).not.toContain(bulk.slice(0, 30));
      expect(err.message).toMatch(/\(truncated, \d+ chars\) \(BLC_BUILD_FAILED\)$/);
      expect(err.message.length).toBeLessThan(2100);
    });
  });

  it('BLC_MISSING_SOURCE: sourcePath absent (DQ-2)', async () => {
    await expectBLC(
      dockerBuilder.build({
        projectRoot: '.',
        buildConfig: { image: { repository: 'test.local/app' } },
        buildEnv: {},
        outputDir: join('.', 'out'),
      } as BuildContext),
      BLC_MISSING_SOURCE,
    );
  });

  it('BLC_INVALID_CONFIG: image.repository missing (FR-004)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { digest: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const err = await expectBLC(
        dockerBuilder.build(ctx(fixture.root, { buildConfig: { image: {}, tag: 'x' } as unknown })),
        BLC_INVALID_CONFIG,
      );
      expect(err.message).toContain('repository');
    });
  });

  it('BLC_INVALID_CONFIG: invalid tag (whitespace) → BLC_INVALID_CONFIG', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    await expectBLC(
      dockerBuilder.build(
        ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app', tag: 'bad tag' } } }),
      ),
      BLC_INVALID_CONFIG,
    );
  });

  it('BLC_INVALID_CONFIG: tag starting with "-" (arg injection) → BLC_INVALID_CONFIG', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    await expectBLC(
      dockerBuilder.build(
        ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app', tag: '-rm' } } }),
      ),
      BLC_INVALID_CONFIG,
    );
  });

  it('BLC_ENV_NOT_RESOLVED: residual {{$TAG}} in image.tag (US5-AC2/Sc7)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    await expectBLC(
      dockerBuilder.build(
        ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app', tag: '{{$TAG}}' } } }),
      ),
      BLC_ENV_NOT_RESOLVED,
    );
  });

  it('FR-012: credentials from buildEnv never reach the docker CLI argv/env', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { digest: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      await dockerBuilder.build(
        ctx(fixture.root, {
          buildEnv: { DOCKER_REGISTRY_URL: 'registry.example.com', DOCKER_AUTH_TOKEN: 'sekrit' },
        }),
      );
    });
    const args = readLogLines(bins.logFile).join('\n');
    const env = readLogLines(bins.envLogFile).join('\n');
    expect(args).not.toContain('DOCKER_AUTH_TOKEN');
    expect(args).not.toContain('registry.example.com');
    expect(env).not.toMatch(/^DOCKER_AUTH_TOKEN=/);
  });

  it('unknown top-level key ignored; build succeeds (coexistence with B-shared fields)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { digest: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(
        ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app' }, exec_timeout: 30 } }),
      );
      expect((artifact.value as DockerArtifactValue).image).toBe(`test.local/app@sha256:${SHA_256_A}`);
    });
  });
});