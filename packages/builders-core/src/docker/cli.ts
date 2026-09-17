/**
 * Docker CLI wrapper (SC-004, worker role: build → push → digest). Thin
 * orchestration of the Docker CLI only — no registry auth, no Dockerfile
 * content (Constitution II: characterized by fake-docker tests). The returned
 * artifact image is always the immutable digest form; mutable push tags never
 * leak into the artifact (FR-011).
 *
 * spec 028 dev-modes: `host` (image.mode: 'remote') forwards DOCKER_HOST to
 * every child process (build/push/inspect) and resolves the content digest via
 * `docker image inspect --format '{{.Id}}'` on that same daemon. A daemon
 * unreachability (local or remote) surfaces as BLC_DOCKER_UNREACHABLE with an
 * actionable stairway — never a partial artifact / silent skip (V).
 *
 * stderr tails are hard-truncated with `…(truncated, N chars)` (DQ-6).
 */

import { spawn } from 'node:child_process';

import {
  BLC_BUILD_FAILED,
  BLC_DOCKER_UNREACHABLE,
  BLC_IMAGE_DIGEST_UNAVAILABLE,
  builderError,
} from '../diagnostics.js';

export interface BuildAndPushOptions {
  readonly sourcePath: string;
  readonly repository: string;
  readonly tag: string;
  readonly dockerfile: string;
  /** Only-build mode (image.no_push, spec 027): resolve digest from the local daemon, never push. */
  readonly noPush?: boolean;
  /** image.mode: 'remote' (spec 028) — DOCKER_HOST of the build daemon. */
  readonly host?: string;
}

interface CommandOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

/** Standard daemon-unreachability markers seen in `docker build`/`push` stderr. */
const DAEMON_UNREACHABLE_MARKERS =
  /Cannot connect to the Docker daemon|error during connect|failed to connect to the docker API/;

function isDaemonUnreachable(stderr: string): boolean {
  return DAEMON_UNREACHABLE_MARKERS.test(stderr);
}

function runDocker(args: readonly string[], cwd: string, host?: string): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const options: { cwd: string; stdio: ['ignore', 'pipe', 'pipe']; env?: Record<string, string | undefined> } = {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    if (host !== undefined) {
      // node:child_process `env` REPLACES the whole environment — spread the
      // current one so PATH (and the fake-docker resolution) is preserved.
      options.env = { ...process.env, DOCKER_HOST: host };
    }
    const child = spawn('docker', [...args], options);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}

/** Keep only the tail of a long stderr stream (DQ-6). */
export function tailStderr(stderr: string): string {
  const marker = `…(truncated, ${stderr.length - 2000} chars)`;
  const keep = 2000 + marker.length;
  return stderr.length <= keep ? stderr : `${stderr.slice(-keep)}${marker}`;
}

function digestFromPushOutput(stdout: string): string | undefined {
  const match = stdout.match(/(?:@sha256:|digest: )(sha256:[0-9a-f]{64})/);
  return match?.[1];
}

/** BLC_DOCKER_UNREACHABLE with an actionable stairway (spec 028, V). */
function unreachableError(host: string | undefined, detail: string): never {
  const where = host !== undefined ? `at '${host}'` : 'locally';
  throw builderError(
    BLC_DOCKER_UNREACHABLE,
    `docker daemon is unreachable ${where}: ${tailStderr(detail)} (${BLC_DOCKER_UNREACHABLE}) — start the docker daemon (Docker Desktop / dockerd), or declare an existing image with image.mode: 'registry-ref', or point image.mode: 'remote' at a reachable daemon host`,
  );
}

export async function buildAndPush(options: BuildAndPushOptions): Promise<string> {
  const { sourcePath, repository, tag, dockerfile, host } = options;
  const ref = `${repository}:${tag}`;

  let output: CommandOutput;
  try {
    output = await runDocker(['build', '-f', dockerfile, '-t', ref, sourcePath], sourcePath, host);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw builderError(BLC_BUILD_FAILED, `docker CLI unavailable: ${detail} (${BLC_BUILD_FAILED})`);
  }
  if (output.code !== 0) {
    if (isDaemonUnreachable(output.stderr)) {
      unreachableError(host, output.stderr);
    }
    throw builderError(
      BLC_BUILD_FAILED,
      `docker build failed: ${tailStderr(output.stderr)} (${BLC_BUILD_FAILED})`,
    );
  }

  if (options.noPush === true) {
    const inspect = await runDocker(['image', 'inspect', '--format', '{{.Id}}', ref], sourcePath, host);
    if (inspect.code === 0) {
      const fromInspect = inspect.stdout.match(/sha256:[0-9a-f]{64}/);
      if (fromInspect !== null) {
        return fromInspect[0];
      }
    }
    throw builderError(
      BLC_IMAGE_DIGEST_UNAVAILABLE,
      `local daemon digest could not be resolved for '${ref}' (build succeeded, no-push mode) (${BLC_IMAGE_DIGEST_UNAVAILABLE})`,
    );
  }

  output = await runDocker(['push', ref], sourcePath, host);
  if (output.code !== 0) {
    if (isDaemonUnreachable(output.stderr)) {
      unreachableError(host, output.stderr);
    }
    throw builderError(
      BLC_BUILD_FAILED,
      `docker push failed: ${tailStderr(output.stderr)} (${BLC_BUILD_FAILED})`,
    );
  }

  if (host !== undefined) {
    // remote (spec 028): content digest of the pushed image from the SAME
    // daemon via {{.Id}} — independent of registry push output.
    const inspect = await runDocker(['image', 'inspect', '--format', '{{.Id}}', ref], sourcePath, host);
    if (inspect.code === 0) {
      const fromInspect = inspect.stdout.match(/sha256:[0-9a-f]{64}/);
      if (fromInspect !== null) {
        return fromInspect[0];
      }
    }
    throw builderError(
      BLC_IMAGE_DIGEST_UNAVAILABLE,
      `push to '${ref}' succeeded but digest could not be resolved on '${host}' (${BLC_IMAGE_DIGEST_UNAVAILABLE})`,
    );
  }

  const fromPush = digestFromPushOutput(output.stdout);
  if (fromPush !== undefined) {
    return fromPush;
  }

  const inspect = await runDocker(['image', 'inspect', '--format', '{{index .RepoDigests 0}}', ref], sourcePath);
  if (inspect.code === 0) {
    const fromInspect = inspect.stdout.match(/sha256:[0-9a-f]{64}/);
    if (fromInspect !== null) {
      return fromInspect[0];
    }
  }

  throw builderError(
    BLC_IMAGE_DIGEST_UNAVAILABLE,
    `push to '${ref}' succeeded but digest could not be resolved (${BLC_IMAGE_DIGEST_UNAVAILABLE})`,
  );
}