import { run, runOrThrow } from './exec.js';

export interface HttpResponse {
  readonly status: number;
  readonly text: string;
  readonly headers: Headers;
}

export async function httpGet(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 30_000,
): Promise<HttpResponse> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  return { status: response.status, text, headers: response.headers };
}

export async function invokeFunction(functionId: string, event: unknown): Promise<unknown> {
  const result = await runOrThrow(
    'yc',
    ['serverless', 'function', 'invoke', '--id', functionId, '--data', JSON.stringify(event)],
    { env: process.env, timeoutMs: 120_000 },
  );
  const stdout = result.stdout.trim();
  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

export async function functionLogs(functionId: string, since = '15m'): Promise<string> {
  const result = await run(
    'yc',
    ['serverless', 'function', 'logs', '--id', functionId, '--since', since, '--limit', '500'],
    { env: process.env, timeoutMs: 120_000 },
  );
  return `${result.stdout}\n${result.stderr}`;
}

function logReadArgs(
  groupId: string,
  since: string,
  filter: string | undefined,
  extra: readonly string[] = [],
): string[] {
  return [
    'logging',
    'read',
    '--group-id',
    groupId,
    '--since',
    since,
    '--limit',
    '100',
    ...(filter !== undefined ? ['--filter', filter] : []),
    ...extra,
  ];
}

export async function readLogGroup(
  groupId: string,
  since = '20m',
  filter?: string,
): Promise<string> {
  // Keep the read small and filtered: a large/unfiltered read pages slowly.
  const result = await run('yc', logReadArgs(groupId, since, filter), {
    env: process.env,
    timeoutMs: 90_000,
  });
  return `${result.stdout}\n${result.stderr}`;
}

export async function waitForLogGroup(
  groupId: string,
  needle: string,
  options: { timeoutMs?: number; pollMs?: number; since?: string; filter?: string } = {},
): Promise<string> {
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  let last = '';
  while (Date.now() < deadline) {
    last = await readLogGroup(groupId, options.since ?? '20m', options.filter);
    if (last.includes(needle)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 5_000));
  }
  throw new Error(`log needle '${needle}' not found in log group ${groupId} within timeout`);
}

export async function waitForLog(
  functionId: string,
  needle: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<string> {
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  let last = '';
  while (Date.now() < deadline) {
    last = await functionLogs(functionId);
    if (last.includes(needle)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 5_000));
  }
  throw new Error(`log needle '${needle}' not found for function ${functionId} within timeout`);
}

export async function terraformOutputs(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<Record<string, unknown>> {
  const result = await runOrThrow('terraform', ['output', '-json'], { cwd, env });
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

export function outputValue(outputs: Record<string, unknown>, name: string): string {
  const entry = outputs[name] as { value?: unknown } | undefined;
  if (entry === undefined) {
    throw new Error(`terraform output '${name}' is missing`);
  }
  return String(entry.value);
}
