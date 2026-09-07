import { delimiter, join } from 'node:path';

import { writeExecutable } from './fixture-project.js';

/**
 * Fake executable generators for hermetic builder tests (T008). Each fake is
 * a deterministic bash script with options baked in (no env-contract between
 * test and fake): it records arguments / pwd / selected env vars to a log file
 * and behaves per its baked mode. The docker CLI wrapper is a thin
 * orchestration layer → characterization (Constitution II exception).
 */

export interface FakeDockerOptions {
  /** 64-hex digest printed on `push` output (absent → no digest from push). */
  readonly digest?: string;
  /** exit code for `docker build`. */
  readonly buildExit?: number;
  /** exit code for `docker push`. */
  readonly pushExit?: number;
  /** `sha256:…` emitted by the inspect fallback (absent → none). */
  readonly inspectSha?: string;
  /** verbatim stderr spilled on a failing `docker build`. */
  readonly buildStderr?: string;
}

export interface FakeDockerBins {
  readonly binDir: string;
  readonly logFile: string;
  readonly envLogFile: string;
}

/** Write a fake `docker` executable into `binDir`; returns capture paths. */
export function fakeDocker(binDir: string, options: FakeDockerOptions = {}): FakeDockerBins {
  const logFile = join(binDir, 'docker-args.log');
  const envLogFile = join(binDir, 'docker-env.log');

  const digest = options.digest ?? '';
  const buildExit = options.buildExit ?? 0;
  const pushExit = options.pushExit ?? 0;
  const inspectSha = options.inspectSha ?? '';
  const buildStderr = options.buildStderr ?? '';

  const script = `#!/usr/bin/env bash
{
  printf 'ARG %s\\n' "$@"
} >> "${logFile}"
{
  env | sort
} >> "${envLogFile}"

cmd="$1"
shift

case "$cmd" in
  build)
    if [ "${buildExit}" -ne 0 ]; then
      if [ -n "${buildStderr}" ]; then
        printf '%s' "${buildStderr}" >&2
      else
        echo "docker build failed: fake nonzero build" >&2
      fi
      exit ${buildExit}
    fi
    echo "building ${1} -> ${2}" >&2
    exit 0
    ;;
  push)
    if [ "${pushExit}" -ne 0 ]; then
      echo "denied: permission to push denied" >&2
      exit ${pushExit}
    fi
    if [ -n "${digest}" ]; then
      echo "test.local/app:v1: digest: sha256:${digest} size: 1234"
    fi
    exit 0
    ;;
  image)
    if [ -n "${inspectSha}" ]; then
      echo "[test.local/app@${inspectSha}]"
    fi
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`;
  writeExecutable(join(binDir, 'docker'), script);
  return { binDir, logFile, envLogFile };
}

export interface FakeViteOptions {
  /** Env var names captured to the log and to `dist/env.txt`. */
  readonly captureEnv: readonly string[];
  /** Static files baked into `dist/` on success. */
  readonly distFiles?: Record<string, string>;
  /** exit code for the fake vite invocation. */
  readonly exitCode?: number;
  /** whether the successful build writes `dist/` (false → missing output). */
  readonly createDist?: boolean;
  /** stderr line on failure. */
  readonly failMessage?: string;
}

export interface FakeViteBins {
  readonly logFile: string;
}

/** Write a fake `vite` executable into `binDir` (the app's `.bin`). */
export function fakeVite(binDir: string, options: FakeViteOptions = { captureEnv: [] }): FakeViteBins {
  const logFile = join(binDir, 'vite-args.log');
  const exitCode = options.exitCode ?? 0;
  const createDist = options.createDist ?? true;
  const captureEnv = options.captureEnv;

  const envLines = captureEnv
    .map((key) => `  printf 'ENV ${key}=%s\\n' "$VAR_${key}"`)
    .join('\n');
  const envBlock = captureEnv.length > 0 ? envLines : '  :';

  const distFiles = options.distFiles ?? { 'index.html': '<html>ok</html>\n' };
  const heredocDelim = 'BC_FAKE_VITE_EOF';
  const distWrites = Object.entries(distFiles)
    .map(([rel, content]) => {
      return `cat > "dist/${rel}" <<'${heredocDelim}'\n${content}${heredocDelim}\n`;
    })
    .join('\n');

  const envFileWrites = captureEnv
    .map((key) => `  printf '${key}=%s\\n' "$VAR_${key}" >> "dist/env.txt"`)
    .join('\n');

  const failMessage = options.failMessage ?? 'fake vite exited with failure';

  const readEnv = captureEnv
    .map((key) => `VAR_${key}="\${${key}:-\_unset_}"`)
    .join('\n');

  const script = `#!/usr/bin/env bash
{
  printf 'ARG %s\\n' "$@"
  printf 'PWD %s\\n' "$(pwd)"
} >> "${logFile}"
${readEnv}
{
${envBlock}
} >> "${logFile}"

if [ "${exitCode}" -ne 0 ]; then
  echo "${failMessage}" >&2
  exit ${exitCode}
fi

if [ "${createDist}" = "true" ]; then
  mkdir -p dist
${distWrites}
${envFileWrites}
fi
exit 0
`;
  writeExecutable(join(binDir, 'vite'), script);
  return { logFile };
}

/** Run `fn` with `prependDir` first on `process.env.PATH`; restores after. */
export async function withPath<T>(prependDir: string, fn: () => Promise<T>): Promise<T> {
  const original = process.env.PATH ?? '';
  process.env.PATH = `${prependDir}${original === '' ? '' : `${delimiter}${original}`}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = original;
  }
}