import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { BuildContext, DockerArtifactValue } from '../../src/types.js';
import {
  BLC_BUILD_FAILED,
  BLC_DOCKER_UNREACHABLE,
  BLC_ENV_NOT_RESOLVED,
  BLC_IMAGE_DIGEST_UNAVAILABLE,
  BLC_INVALID_CONFIG,
  BLC_MISSING_SOURCE,
} from '../../src/diagnostics.js';
import dockerBuilder from '../../src/docker/index.js';
import { dockerFixture, makeTempDir, writeProject, type TempDir } from '../helpers/fixture-project.js';
import { fakeDocker, withPath } from '../helpers/fake-bins.js';

const SHA_256_A = 'a'.repeat(64);
const SHA_256_B = 'b'.repeat(64);

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

/** True when a local docker daemon responds to `docker info` (gated smoke, spec 027 §13). */
function probeDockerDaemon(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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

  it('D10: RELATIVE source_path is resolved against projectRoot (no apps/x/apps/x double-up)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    writeProject(fixture.root, {
      'apps/analytics/Dockerfile': 'FROM node:22-alpine\n',
      'apps/analytics/index.js': 'console.log("analytics");\n',
    });
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { digest: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(
        ctx(fixture.root, { sourcePath: 'apps/analytics' }),
      );
      expect((artifact.value as DockerArtifactValue).image).toBe(`test.local/app@sha256:${SHA_256_A}`);
    });
    const args = readLogLines(bins.logFile);
    // docker build context = projectRoot-joined absolute path, never the relative verbatim.
    expect(args).toContain(`ARG ${join(fixture.root, 'apps/analytics')}`);
    expect(args).not.toContain('ARG apps/analytics');
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

describe('docker builder no-push (spec 027)', () => {
  const dirs: TempDir[] = [];

  afterEach(() => {
    for (const d of dirs) {
      d.remove();
    }
    dirs.length = 0;
  });

  it('BLC_INVALID_CONFIG: no_push "true" (non-boolean) fails config, CLI never invoked (FR-006)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    const err = await withPath(bins.binDir, async () => {
      return expectBLC(
        dockerBuilder.build(
          ctx(fixture.root, {
            buildConfig: {
              image: { repository: 'test.local/app', tag: 'v1', no_push: 'true' },
              dockerfile: 'Dockerfile',
            },
          }),
        ),
        BLC_INVALID_CONFIG,
      );
    });
    expect((err as Error & { field?: string }).field).toBe('image.no_push');
    const args = existsSync(bins.logFile) ? readLogLines(bins.logFile) : [];
    expect(args).toHaveLength(0);
    expect(args).not.toContain('ARG push');
  });

  it('BLC_INVALID_CONFIG: no_push 1 (non-boolean) fails config (FR-006)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    const err = await withPath(bins.binDir, async () => {
      return expectBLC(
        dockerBuilder.build(
          ctx(fixture.root, {
            buildConfig: { image: { repository: 'test.local/app', tag: 'v1', no_push: 1 } },
          }),
        ),
        BLC_INVALID_CONFIG,
      );
    });
    expect((err as Error & { field?: string }).field).toBe('image.no_push');
    const args = existsSync(bins.logFile) ? readLogLines(bins.logFile) : [];
    expect(args).toHaveLength(0);
  });

  it('BLC_INVALID_CONFIG: no_push null (non-boolean) fails config (FR-006)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    const err = await withPath(bins.binDir, async () => {
      return expectBLC(
        dockerBuilder.build(
          ctx(fixture.root, {
            buildConfig: { image: { repository: 'test.local/app', tag: 'v1', no_push: null } },
          }),
        ),
        BLC_INVALID_CONFIG,
      );
    });
    expect((err as Error & { field?: string }).field).toBe('image.no_push');
    const args = existsSync(bins.logFile) ? readLogLines(bins.logFile) : [];
    expect(args).toHaveLength(0);
  });

  it('BLC_INVALID_CONFIG: no_push true without image.repository (FR-006)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    const err = await withPath(bins.binDir, async () => {
      return expectBLC(
        dockerBuilder.build(
          ctx(fixture.root, {
            buildConfig: { image: { no_push: true } },
          }),
        ),
        BLC_INVALID_CONFIG,
      );
    });
    expect(err.message).toContain('repository');
  });

  it('coexistence: no_push true + unknown top-level key ignored (FR-007)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { digest: SHA_256_A, localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(
        ctx(fixture.root, {
          buildConfig: { image: { repository: 'test.local/app', no_push: true }, exec_timeout: 30 },
        }),
      );
      expect((artifact.value as DockerArtifactValue).image).toBe(`test.local/app@sha256:${SHA_256_A}`);
    });
  });

  it('SC-001/AC1: no_push true → local build artifact in immutable digest form', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(
        ctx(fixture.root, {
          buildConfig: { image: { repository: 'test.local/app', tag: 'v1', no_push: true }, dockerfile: 'Dockerfile' },
        }),
      );
      expect(artifact.type).toBe('ycforge:docker-image');
      expect((artifact.value as DockerArtifactValue).image).toBe(`test.local/app@sha256:${SHA_256_A}`);
      expect((artifact.value as DockerArtifactValue).image).toMatch(/@sha256:[a-f0-9]{64}$/);
    });
  });

  it('SC-002/AC2: no-push build never invokes docker push (argv log)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      await dockerBuilder.build(
        ctx(fixture.root, {
          buildConfig: { image: { repository: 'test.local/app', tag: 'v1', no_push: true }, dockerfile: 'Dockerfile' },
        }),
      );
    });
    const args = readLogLines(bins.logFile);
    expect(args).toContain('ARG build');
    expect(args).toContain('ARG -f');
    expect(args).toContain('ARG Dockerfile');
    expect(args).toContain('ARG test.local/app:v1');
    expect(args).toContain('ARG image');
    expect(args).toContain('ARG {{.Id}}');
    expect(args).toContain('ARG test.local/app:v1');
    expect(args).not.toContain('ARG push');
    expect(args).not.toContain('ARG {{index .RepoDigests 0}}');
  });

  it('SC-003/AC3: repeated identical builds → identical deterministic local digest', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const first = await dockerBuilder.build(
        ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app', tag: 'v1', no_push: true } } }),
      );
      const second = await dockerBuilder.build(
        ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app', tag: 'v1', no_push: true } } }),
      );
      expect((first.value as DockerArtifactValue).image).toBe((second.value as DockerArtifactValue).image);
      expect((first.value as DockerArtifactValue).image).toBe(`test.local/app@sha256:${SHA_256_A}`);
    });
  });

  it('US-2/AC2: no tag → local :latest addressable, value.image stays digest-only', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(
        ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app', no_push: true } } }),
      );
      const image = (artifact.value as DockerArtifactValue).image;
      expect(image).toBe(`test.local/app@sha256:${SHA_256_A}`);
      expect(image).not.toContain(':latest');
      expect(image).not.toContain(':v1');
    });
    const args = readLogLines(bins.logFile);
    expect(args).toContain('ARG test.local/app:latest');
  });

  it('US-2/AC1: value.image is exactly <repository>@sha256:<hex> across tag/repository variants', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    const cases: ReadonlyArray<{ readonly repository: string; readonly tag?: string }> = [
      { repository: 'test.local/app', tag: 'v1' },
      { repository: 'test.local/app' },
      { repository: 'cr.yandex/crp/analytics/extra', tag: 'v2' },
    ];
    await withPath(bins.binDir, async () => {
      for (const c of cases) {
        const artifact = await dockerBuilder.build(
          ctx(fixture.root, {
            buildConfig: {
              image: { repository: c.repository, ...(c.tag === undefined ? {} : { tag: c.tag }), no_push: true },
            },
          }),
        );
        const image = (artifact.value as DockerArtifactValue).image;
        expect(image).toBe(`${c.repository}@sha256:${SHA_256_A}`);
        expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
        expect(image).not.toMatch(/:(latest|v1|v2)@sha256:/);
      }
    });
  });

  it('SC-005: without no_push the push path is unchanged (option never activates local path)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { digest: SHA_256_A, localId: SHA_256_B });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(ctx(fixture.root));
      expect((artifact.value as DockerArtifactValue).image).toBe(`test.local/app@sha256:${SHA_256_A}`);
    });
    const args = readLogLines(bins.logFile);
    expect(args).toContain('ARG push');
    expect(args).not.toContain('ARG {{.Id}}');
  });

  it('US-3/AC1: docker CLI unavailable (empty PATH) → BLC_BUILD_FAILED, no push (FR-005)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    const emptyDir = makeTempDir('bc-nodocker-');
    dirs.push(emptyDir);
    const prevPath = process.env.PATH;
    try {
      process.env.PATH = emptyDir.root;
      const err = await expectBLC(
        dockerBuilder.build(
          ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app', tag: 'v1', no_push: true } } }),
        ),
        BLC_BUILD_FAILED,
      );
      expect(err.message).toContain('docker CLI unavailable');
    } finally {
      process.env.PATH = prevPath;
    }
    const args = existsSync(bins.logFile) ? readLogLines(bins.logFile) : [];
    expect(args).not.toContain('ARG push');
  });

  it('US-3/AC2: daemon down (buildExit=1 + socket stderr) → BLC_DOCKER_UNREACHABLE with stairway, no push (FR-005, spec 028)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), {
      buildExit: 1,
      buildStderr: 'Cannot connect to the Docker daemon. Is the docker daemon running?\n',
    });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const err = await expectBLC(
        dockerBuilder.build(
          ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app', tag: 'v1', no_push: true } } }),
        ),
        BLC_DOCKER_UNREACHABLE,
      );
      expect(err.message).toContain('the Docker daemon');
      expect(err.message).toMatch(/registry-ref/);
      expect(err.message).toMatch(/remote/);
    });
    const args = readLogLines(bins.logFile);
    expect(args).not.toContain('ARG push');
  });

  it('US-3/AC3: build ok but no local digest → BLC_IMAGE_DIGEST_UNAVAILABLE, no artifact, no push (FR-004)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'));
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const err = await expectBLC(
        dockerBuilder.build(
          ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app', tag: 'v1', no_push: true } } }),
        ),
        BLC_IMAGE_DIGEST_UNAVAILABLE,
      );
      expect(err.message).toMatch(/local daemon digest/);
    });
    const args = readLogLines(bins.logFile);
    expect(args).toContain('ARG build');
    expect(args).not.toContain('ARG push');
    expect(args).not.toContain('ARG {{index .RepoDigests 0}}');
  });

  it('US-4/AC1: credentials in buildEnv never reach CLI argv/env in no-push mode (FR-012)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(
        ctx(fixture.root, {
          buildConfig: { image: { repository: 'test.local/app', tag: 'v1', no_push: true } },
          buildEnv: { DOCKER_REGISTRY_URL: 'registry.example.com', DOCKER_AUTH_TOKEN: 'sekrit' },
        }),
      );
      expect((artifact.value as DockerArtifactValue).image).toBe(`test.local/app@sha256:${SHA_256_A}`);
    });
    const args = readLogLines(bins.logFile).join('\n');
    const env = readLogLines(bins.envLogFile).join('\n');
    expect(args).not.toContain('DOCKER_AUTH_TOKEN');
    expect(args).not.toContain('registry.example.com');
    expect(args).not.toContain('ARG push');
    expect(env).not.toMatch(/^DOCKER_AUTH_TOKEN=/);
  });
});

// Gated integration smoke: runs only where a real docker daemon is up (spec 027 §13);
// skipped on this machine (daemon down) and on unit-CI. Boundary: proof of "no push"
// rests on the hermetic argv log above; the real-daemon check only asserts the artifact
// is a local digest form (a network-pull failure on `FROM node:22-alpine` is skipped).
describe.skipIf(!probeDockerDaemon())('docker daemon no-push smoke (spec 027, gated)', () => {
  const dirs: TempDir[] = [];

  afterEach(() => {
    for (const d of dirs) {
      d.remove();
    }
    dirs.length = 0;
  });

  it('local-only build yields a digest-form artifact (SC-001)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    try {
      const artifact = await dockerBuilder.build(
        ctx(fixture.root, {
          buildConfig: { image: { repository: 'test.local/app', tag: 'v1', no_push: true } },
        }),
      );
      expect((artifact.value as DockerArtifactValue).image).toMatch(/^test\.local\/app@sha256:[a-f0-9]{64}$/);
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === BLC_BUILD_FAILED) {
        return;
      }
      throw err;
    }
    // A real image build (base-image pull + build) legitimately exceeds the
    // 5s Vitest default on CI runners; the gate only decides whether it runs.
  }, 180_000);
});

describe('docker dev-modes (spec 028): registry-ref', () => {
  const dirs: TempDir[] = [];
  const REF = `test.local/app@sha256:${SHA_256_A}`;

  afterEach(() => {
    for (const d of dirs) {
      d.remove();
    }
    dirs.length = 0;
  });

  it('T028: valid image.ref → value.image is the ref verbatim, ZERO docker subprocess calls (no daemon, no creds)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { digest: SHA_256_B });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(
        ctx(fixture.root, { buildConfig: { image: { mode: 'registry-ref', ref: REF } } }),
      );
      expect(artifact.type).toBe('ycforge:docker-image');
      expect((artifact.value as DockerArtifactValue).image).toBe(REF);
    });
    expect(existsSync(bins.logFile)).toBe(false);
    expect(existsSync(bins.envLogFile)).toBe(false);
  });

  it('T028: registry-ref needs no sourcePath and no docker CLI (no build at all)', async () => {
    const artifact = await dockerBuilder.build({
      projectRoot: '.',
      buildConfig: { image: { mode: 'registry-ref', ref: REF } },
      buildEnv: {},
      outputDir: join('.', 'out'),
    } as BuildContext);
    expect((artifact.value as DockerArtifactValue).image).toBe(REF);
  });

  it('T028: mutable-tag ref (repo:latest@sha256:…) → BLC_INVALID_CONFIG field image.ref (never a mutable tag)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const err = await expectBLC(
      dockerBuilder.build(
        ctx(fixture.root, {
          buildConfig: { image: { mode: 'registry-ref', ref: `test.local/app:latest@sha256:${SHA_256_A}` } },
        }),
      ),
      BLC_INVALID_CONFIG,
    );
    expect((err as { field?: string }).field).toBe('image.ref');
  });

  it('T028: bare mutable tag without digest (repo:latest) → BLC_INVALID_CONFIG', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    await expectBLC(
      dockerBuilder.build(
        ctx(fixture.root, { buildConfig: { image: { mode: 'registry-ref', ref: 'test.local/app:latest' } } }),
      ),
      BLC_INVALID_CONFIG,
    );
  });

  it('T028: mutual exclusion — image.repository together with registry-ref → BLC_INVALID_CONFIG (D-3)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    await expectBLC(
      dockerBuilder.build(
        ctx(fixture.root, {
          buildConfig: { image: { mode: 'registry-ref', ref: REF, repository: 'other/app' } },
        }),
      ),
      BLC_INVALID_CONFIG,
    );
  });

  it('T028: mutual exclusion — dockerfile together with registry-ref → BLC_INVALID_CONFIG (D-3)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    await expectBLC(
      dockerBuilder.build(
        ctx(fixture.root, { buildConfig: { dockerfile: 'AltDockerfile', image: { mode: 'registry-ref', ref: REF } } }),
      ),
      BLC_INVALID_CONFIG,
    );
  });

  it('T028: no_push true + registry-ref is a valid no-op (027-compat, edge)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const artifact = await dockerBuilder.build(
      ctx(fixture.root, { buildConfig: { image: { mode: 'registry-ref', ref: REF, no_push: true } } }),
    );
    expect((artifact.value as DockerArtifactValue).image).toBe(REF);
  });
});

describe('docker dev-modes (spec 028): remote + default-unreachable', () => {
  const dirs: TempDir[] = [];

  afterEach(() => {
    for (const d of dirs) {
      d.remove();
    }
    dirs.length = 0;
  });

  it('T029: image.host is required in remote mode → BLC_INVALID_CONFIG without it', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    await expectBLC(
      dockerBuilder.build(
        ctx(fixture.root, { buildConfig: { image: { repository: 'test.local/app', tag: 'v1', mode: 'remote' } } }),
      ),
      BLC_INVALID_CONFIG,
    );
  });

  it('T029: remote build+push carry DOCKER_HOST in env; digest from {{.Id}} on the same daemon', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { digest: SHA_256_A, localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(
        ctx(fixture.root, {
          buildConfig: { image: { repository: 'test.local/app', tag: 'v1', mode: 'remote', host: 'tcp://remote:2375' } },
        }),
      );
      expect((artifact.value as DockerArtifactValue).image).toBe(`test.local/app@sha256:${SHA_256_A}`);
    });
    const args = readLogLines(bins.logFile);
    expect(args).toContain('ARG build');
    expect(args).toContain('ARG push');
    expect(args).toContain('ARG image');
    expect(args).toContain('ARG {{.Id}}');
    const env = readLogLines(bins.envLogFile);
    expect(env).toContain('DOCKER_HOST=tcp://remote:2375');
  });

  it('T029: remote no_push → only-build on the remote daemon (DOCKER_HOST, no push)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const artifact = await dockerBuilder.build(
        ctx(fixture.root, {
          buildConfig: {
            image: { repository: 'test.local/app', tag: 'v1', mode: 'remote', host: 'tcp://remote:2375', no_push: true },
          },
        }),
      );
      expect((artifact.value as DockerArtifactValue).image).toBe(`test.local/app@sha256:${SHA_256_A}`);
    });
    const args = readLogLines(bins.logFile);
    expect(args).toContain('ARG build');
    expect(args).toContain('ARG image');
    expect(args).toContain('ARG {{.Id}}');
    expect(args).not.toContain('ARG push');
    const env = readLogLines(bins.envLogFile);
    expect(env).toContain('DOCKER_HOST=tcp://remote:2375');
  });

  it('T029: remote connect/auth failure → BLC_DOCKER_UNREACHABLE with host in message (remote-scope)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), {
      buildExit: 1,
      buildStderr: 'error during connect: Could not connect to the docker daemon\n',
    });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const err = await expectBLC(
        dockerBuilder.build(
          ctx(fixture.root, {
            buildConfig: { image: { repository: 'test.local/app', mode: 'remote', host: 'tcp://remote:2375' } },
          }),
        ),
        BLC_DOCKER_UNREACHABLE,
      );
      expect(err.message).toContain('tcp://remote:2375');
      expect(err.message).toMatch(/registry-ref/);
    });
  });

  it('T029: default mode daemon-down → BLC_DOCKER_UNREACHABLE with actionable stairway, no push, no partial artifact', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), {
      buildExit: 1,
      buildStderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the daemon running?\n',
    });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const err = await expectBLC(dockerBuilder.build(ctx(fixture.root)), BLC_DOCKER_UNREACHABLE);
      expect(err.message).toMatch(/registry-ref/);
      expect(err.message).toMatch(/remote/);
    });
    const args = readLogLines(bins.logFile);
    expect(args).toContain('ARG build');
    expect(args).not.toContain('ARG push');
  });

  it('T029: other build failures keep BLC_BUILD_FAILED + stderr tail (classification isolated)', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), {
      buildExit: 1,
      buildStderr: 'The build failed for an unrelated reason: x\n',
    });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const err = await expectBLC(dockerBuilder.build(ctx(fixture.root)), BLC_BUILD_FAILED);
      expect(err.message).toContain('unrelated reason');
    });
  });

  it('T029: 027-compat value.image table — every mode yields digest-only form, never a mutable tag', async () => {
    const fixture = dockerFixture();
    dirs.push(fixture);
    const bins = fakeDocker(join(fixture.root, 'fake-bin'), { digest: SHA_256_A, localId: SHA_256_A });
    dirs.push({ root: bins.binDir, remove: () => {} });
    await withPath(bins.binDir, async () => {
      const cases: ReadonlyArray<unknown> = [
        { image: { repository: 'test.local/app', tag: 'v1' } },
        { image: { repository: 'test.local/app', tag: 'v1', no_push: true } },
        { image: { repository: 'test.local/app', mode: 'remote', host: 'tcp://r:2375' } },
        { image: { mode: 'registry-ref', ref: `test.local/app@sha256:${SHA_256_A}` } },
      ];
      for (const buildConfig of cases) {
        const artifact = await dockerBuilder.build(ctx(fixture.root, { buildConfig }));
        const image = (artifact.value as DockerArtifactValue).image;
        expect(image).toMatch(/@sha256:[a-f0-9]{64}$/);
        expect(image).not.toMatch(/:(latest|v1)@/);
      }
    });
  });
});