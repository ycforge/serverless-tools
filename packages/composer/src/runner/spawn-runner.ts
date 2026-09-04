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
const MAX_RESULT_BYTES = 8 * 1024 * 1024;

type RunnerFailureMarker = 'LOAD' | 'EXEC' | 'INVALID';

const FAILURE_CODES: Record<RunnerFailureMarker, ExtractErrorCode> = {
  LOAD: 'ENTRY_LOAD_FAILED',
  EXEC: 'ENTRY_EXECUTION_FAILED',
  INVALID: 'ENTRY_RETURNED_INVALID',
};

const FAILURE_MESSAGES: Record<ExtractErrorCode, string> = {
  NO_SOURCE: 'No OpenAPI source was found',
  INVALID_ARTIFACT: 'The OpenAPI artifact is not a valid OpenAPI document',
  ENTRY_LOAD_FAILED:
    'Entry could not be loaded (missing file, unloadable module, or missing the buildYcsfOpenApi export)',
  ENTRY_EXECUTION_FAILED: 'buildYcsfOpenApi() threw while the entry was executing',
  ENTRY_RETURNED_INVALID: 'Entry produced a value that is not an OpenAPI document',
  ENTRY_TIMEOUT: 'Entry did not complete before the extraction timeout',
  RUNNER_SPAWN_FAILED: 'Failed to start the runner process',
};

function classifyFailure(stderr: string): ExtractErrorCode {
  // Markers carry no detail on purpose: app-provided error text must never be
  // embedded in an extraction error (it may leak payloads/tokens/headers).
  const match = stderr.match(/SERVERLESS_TOOLS_RUNNER:(LOAD|EXEC|INVALID)/m);
  if (match && match[1]) {
    return FAILURE_CODES[match[1] as RunnerFailureMarker];
  }
  return 'ENTRY_EXECUTION_FAILED';
}

export function spawnRunner(
  appRoot: string,
  entryPath: string,
  timeoutMs = 30000,
): Promise<OpenApiDocument> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let result = '';
    let done = false;

    const fail = (err: OpenApiExtractError): void => {
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

    // The third pipe (child fd 3) is the dedicated result channel; the
    // application's own stdout/stderr never carry the extraction result.
    const child = spawn(process.execPath, [RUNNER_PATH, entryPath], {
      env: { ...process.env, SERVERLESS_TOOLS_OPENAPI_BUILD: '1' },
      cwd: appRoot,
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
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

    child.stdout!.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_STDOUT_BYTES) {
        stdout += chunk.toString('utf8');
      } else if (stdout.length < MAX_STDOUT_BYTES + 64) {
        stdout += '\n<maximum stdout size exceeded; rest omitted>';
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr += chunk.toString('utf8');
      } else if (stderr.length < MAX_STDERR_BYTES + 64) {
        stderr += '\n<maximum stderr size exceeded; rest omitted>';
      }
    });

    child.stdio[3]?.on('data', (chunk: Buffer) => {
      if (result.length < MAX_RESULT_BYTES) {
        result += chunk.toString('utf8');
      } else if (result.length < MAX_RESULT_BYTES + 64) {
        result += '\n<maximum result size exceeded; rest omitted>';
      }
    });

    child.on('error', (err) => {
      fail(
        new OpenApiExtractError('RUNNER_SPAWN_FAILED', FAILURE_MESSAGES.RUNNER_SPAWN_FAILED, {
          sourcePath: entryPath,
          cause: err,
        }),
      );
    });

    child.on('close', (code) => {
      if (done) {
        return;
      }
      clearTimeout(timer);

      if (code === 0) {
        const text = result.trim();
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
        } catch {
          fail(
            new OpenApiExtractError(
              'ENTRY_RETURNED_INVALID',
              `Runner for ${entryPath} produced a malformed result document`,
              { sourcePath: entryPath },
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

      const failureCode = classifyFailure(stderr);
      fail(
        new OpenApiExtractError(
          failureCode,
          `${FAILURE_MESSAGES[failureCode]} (${entryPath})`,
          { sourcePath: entryPath },
        ),
      );
    });
  });
}