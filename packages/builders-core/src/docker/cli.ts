/**
 * Docker CLI wrapper (SC-004, worker role: build → push → digest). Thin
 * orchestration of the Docker CLI only — no registry auth, no Dockerfile
 * content (Constitution II: characterized by fake-docker tests). The returned
 * artifact image is always the immutable digest form; mutable push tags never
 * leak into the artifact (FR-011).
 *
 * stderr tails are hard-truncated with `…(truncated, N chars)` (DQ-6).
 */

import { spawn } from 'node:child_process';

import { BLC_BUILD_FAILED, BLC_IMAGE_DIGEST_UNAVAILABLE, builderError } from '../diagnostics.js';

export interface BuildAndPushOptions {
  readonly sourcePath: string;
  readonly repository: string;
  readonly tag: string;
  readonly dockerfile: string;
}

interface CommandOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

function runDocker(args: readonly string[], cwd: string): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
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

export async function buildAndPush(options: BuildAndPushOptions): Promise<string> {
  const { sourcePath, repository, tag, dockerfile } = options;
  const ref = `${repository}:${tag}`;

  let output: CommandOutput;
  try {
    output = await runDocker(['build', '-f', dockerfile, '-t', ref, sourcePath], sourcePath);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    throw builderError(BLC_BUILD_FAILED, `docker CLI unavailable: ${detail} (${BLC_BUILD_FAILED})`);
  }
  if (output.code !== 0) {
    throw builderError(
      BLC_BUILD_FAILED,
      `docker build failed: ${tailStderr(output.stderr)} (${BLC_BUILD_FAILED})`,
    );
  }

  output = await runDocker(['push', ref], sourcePath);
  if (output.code !== 0) {
    throw builderError(
      BLC_BUILD_FAILED,
      `docker push failed: ${tailStderr(output.stderr)} (${BLC_BUILD_FAILED})`,
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