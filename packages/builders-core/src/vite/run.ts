/**
 * Vite command runner (D-RE-3, D-RE-10): execs the configured `command` via
 * the shell in the app root with `buildEnv` overlaid on the environment and
 * the app-local `node_modules/.bin` prepended to PATH. Never uses `npx`
 * (D-RE-10); the app owns its toolchain.
 */

import { spawn } from 'node:child_process';
import { delimiter, join } from 'node:path';

import { BLC_BUILD_FAILED, builderError } from '../diagnostics.js';

export interface RunViteOptions {
  readonly sourcePath: string;
  readonly cwd: string;
  readonly command: string;
  readonly buildEnv: Record<string, string>;
}

/** Keep only the tail of a long stderr stream (DQ-6). */
function tailStderr(stderr: string): string {
  const marker = `…(truncated, ${stderr.length - 2000} chars)`;
  const keep = 2000 + marker.length;
  return stderr.length <= keep ? stderr : `${stderr.slice(-keep)}${marker}`;
}

export async function runViteBuild(options: RunViteOptions): Promise<void> {
  const { sourcePath, cwd, command, buildEnv } = options;
  const env: NodeJS.ProcessEnv = { ...process.env, ...buildEnv };
  env.PATH = `${join(sourcePath, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`;

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== null && code !== 0) {
        reject(builderError(BLC_BUILD_FAILED, `vite build failed: ${tailStderr(stderr)} (${BLC_BUILD_FAILED})`));
        return;
      }
      resolve(code);
    });
  });

  if (exitCode !== 0) {
    throw builderError(BLC_BUILD_FAILED, `vite build failed (${BLC_BUILD_FAILED})`);
  }
}