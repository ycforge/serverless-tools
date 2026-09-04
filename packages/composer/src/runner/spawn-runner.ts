import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { OpenApiExtractError, type ExtractErrorCode, type OpenApiDocument } from '../errors.js';
import { isOpenApiDocument } from '../artifacts.js';

export function resolveRunnerPath(currentUrl = import.meta.url): string {
  const sourceCandidate = fileURLToPath(new URL('../../runner/runner.mjs', currentUrl));
  if (existsSync(sourceCandidate)) {
    return sourceCandidate;
  }
  return fileURLToPath(new URL('../runner/runner.mjs', currentUrl));
}

const RUNNER_PATH = resolveRunnerPath();

const MAX_STDOUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;

type RunnerFailureMarker = 'LOAD' | 'EXEC' | 'INVALID';

const FAILURE_CODES: Record<RunnerFailureMarker, ExtractErrorCode> = {
  LOAD: 'ENTRY_LOAD_FAILED',
  EXEC: 'ENTRY_EXECUTION_FAILED',
  INVALID: 'ENTRY_RETURNED_INVALID',
};

function classifyFailure(stderr: string): { code: ExtractErrorCode; detail: string } {
  const match = stderr.match(/SERVERLESS_TOOLS_RUNNER:(LOAD|EXEC|INVALID)(?:\s+(.*))?$/m);
  if (match && match[1]) {
    return {
      code: FAILURE_CODES[match[1] as RunnerFailureMarker],
      detail: (match[2] ?? '').trim(),
    };
  }
  return { code: 'ENTRY_EXECUTION_FAILED', detail: stderr.trim() };
}

export function spawnRunner(
  appRoot: string,
  entryPath: string,
  timeoutMs = 30000,
): Promise<OpenApiDocument> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let done = false;

    const fail = (err: unknown): void => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      reject(err);
    };

    const succeed = (doc: OpenApiDocument): void => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      resolve(doc);
    };

    const child = spawn(process.execPath, [RUNNER_PATH, entryPath], {
      env: { ...process.env, SERVERLESS_TOOLS_OPENAPI_BUILD: '1' },
      cwd: appRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      fail(
        new OpenApiExtractError(
          'ENTRY_TIMEOUT',
          `Entry ${entryPath} did not complete within ${timeoutMs}ms; the runner was killed`,
          { sourcePath: entryPath },
        ),
      );
    }, timeoutMs);
    timer.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT_BYTES) {
        stdout += chunk.toString('utf8');
      } else if (stdout.length < MAX_STDOUT_BYTES + 64) {
        stdout += '\n<maximum stdout size exceeded; rest omitted>';
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr += chunk.toString('utf8');
      } else if (stderr.length < MAX_STDERR_BYTES + 64) {
        stderr += '\n<maximum stderr size exceeded; rest omitted>';
      }
    });

    child.on('error', (err) => {
      fail(
        new OpenApiExtractError(
          'RUNNER_SPAWN_FAILED',
          `Failed to start the runner process for ${entryPath}`,
          { sourcePath: entryPath, cause: err },
        ),
      );
    });

    child.on('close', (code) => {
      if (done) {
        return;
      }
      clearTimeout(timer);

      if (code === 0) {
        const text = stdout.trim();
        if (text === '') {
          fail(
            new OpenApiExtractError(
              'ENTRY_RETURNED_INVALID',
              `Runner for ${entryPath} exited 0 without producing an OpenAPI document`,
              { sourcePath: entryPath },
            ),
          );
          return;
        }
        let doc: unknown;
        try {
          doc = JSON.parse(text);
        } catch (err) {
          fail(
            new OpenApiExtractError(
              'ENTRY_RETURNED_INVALID',
              `Runner for ${entryPath} produced malformed stdout`,
              { sourcePath: entryPath, cause: err },
            ),
          );
          return;
        }
        if (!isOpenApiDocument(doc)) {
          fail(
            new OpenApiExtractError(
              'ENTRY_RETURNED_INVALID',
              `Runner for ${entryPath} produced a value that is not an OpenAPI document`,
              { sourcePath: entryPath },
            ),
          );
          return;
        }
        succeed(doc);
        return;
      }

      const { code: failureCode, detail } = classifyFailure(stderr);
      fail(
        new OpenApiExtractError(
          failureCode,
          detail !== '' ? detail : `Runner for ${entryPath} exited with code ${code}`,
          { sourcePath: entryPath },
        ),
      );
    });
  });
}