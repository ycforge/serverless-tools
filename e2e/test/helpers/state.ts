import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const E2E_ROOT = resolve(import.meta.dirname, '..', '..');
export const REPO_ROOT = resolve(E2E_ROOT, '..');
export const TMP_ROOT = resolve(E2E_ROOT, '.tmp');
export const STATE_FILE = resolve(TMP_ROOT, 'state.json');
export const PILOT_CLI = resolve(REPO_ROOT, 'packages', 'pilot', 'dist', 'cli', 'index.js');

export interface E2eState {
  readonly skipped: boolean;
  readonly reason?: string;
  readonly runId: string;
  readonly tempRoot: string;
  readonly projectDir: string;
  readonly setupDir: string;
  readonly staticBucket: string;
  readonly jwtBucket: string;
  readonly jwtIssuer: string;
  readonly kmsKeyId: string;
  readonly gatewayDomain: string;
  readonly containerUrl: string;
  readonly workerEventsName: string;
  readonly workerDlqEventsName: string;
  readonly workerAppDlqName: string;
  readonly workerFunctionId: string;
  readonly workerDlqFunctionId: string;
  readonly apiFunctionId: string;
  readonly authorizerFunctionId: string;
  readonly renameFunctionId: string;
  readonly outputs: Record<string, unknown>;
  readonly privateKeyPem: string;
  readonly jwk: Record<string, unknown>;
  readonly startedAt: string;
}

export function writeState(state: E2eState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

export function readState(): E2eState {
  if (!existsSync(STATE_FILE)) {
    throw new Error(
      `e2e state file not found at ${STATE_FILE}; run the suite via 'pnpm e2e' (global setup writes it)`,
    );
  }
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2eState;
}
