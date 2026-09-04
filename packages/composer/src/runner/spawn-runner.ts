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
const BUFFER_OVERFLOW_NOTE = '\n<maximum bytes exceeded; rest omitted>';

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

// The runner always writes its failure marker as the LAST line on stderr,
// immediately before exiting. Classification only accepts a marker that is an
// exact, whole line near the end of the accumulated stderr, so arbitrary
// application logging that merely mentions "SERVERLESS_TOOLS_RUNNER:…" can
// never be misread as the runner's verdict.
const MARKER_RE = /^SERVERLESS_TOOLS_RUNNER:(LOAD|EXEC|INVALID)$/;

function classifyFailure(stderr: string): ExtractErrorCode {
  const lines = stderr.trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? '';
    const match = MARKER_RE.exec(line.trim());
    if (match && match[1]) {
      return FAILURE_CODES[match[1] as RunnerFailureMarker];
    }
  }
  return 'ENTRY_EXECUTION_FAILED';
}

export interface ByteAccum {
  text: string;
  bytes: number;
}

// Appends a stream chunk under a cap measured in BYTES (UTF-8), not in
// characters: Buffer#length and subarray slicing both work on bytes, so the
// cap stays correct even for multi-byte encoding.
export function appendByteCapped(
  acc: ByteAccum,
  chunk: Buffer,
  maxBytes: number,
  overflowNote: string,
): void {
  if (acc.bytes >= maxBytes || chunk.length === 0) {
    return;
  }
  const room = maxBytes - acc.bytes;
  if (chunk.length <= room) {
    acc.text += chunk.toString('utf8');
    acc.bytes += chunk.length;
    return;
  }
  acc.text += chunk.subarray(0, room).toString('utf8');
  acc.bytes += room;
  acc.text += overflowNote;
}

export function spawnRunner(
  appRoot: string,
  entryPath: string,
  timeoutMs = 30000,
): Promise<OpenApiDocument> {
  return new Promise((resolve, reject) => {
    const stdout = { text: '', bytes: 0 };
    const stderr = { text: '', bytes: 0 };
    const result = { text: '', bytes: 0 };
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
      appendByteCapped(stdout, chunk, MAX_STDOUT_BYTES, BUFFER_OVERFLOW_NOTE);
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      appendByteCapped(stderr, chunk, MAX_STDERR_BYTES, BUFFER_OVERFLOW_NOTE);
    });

    child.stdio[3]?.on('data', (chunk: Buffer) => {
      appendByteCapped(result, chunk, MAX_RESULT_BYTES, BUFFER_OVERFLOW_NOTE);
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
        const text = result.text.trim();
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

      const failureCode = classifyFailure(stderr.text);
      fail(
        new OpenApiExtractError(failureCode, `${FAILURE_MESSAGES[failureCode]} (${entryPath})`, {
          sourcePath: entryPath,
        }),
      );
    });
  });
}