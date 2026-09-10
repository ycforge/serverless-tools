import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/build/index.js', () => ({
  buildApps: vi.fn(),
}));

import { buildAction } from '../../../src/cli/build.js';
import { buildApps } from '../../../src/build/index.js';
import { ExitCode } from '../../../src/cli/errors.js';

const mockBuildApps = vi.mocked(buildApps);

function fakeCmd(opts: Record<string, unknown> = {}) {
  return {
    optsWithGlobals: () => ({
      projectDir: '/test/root',
      json: false,
      ...opts,
    }),
  } as never;
}

describe('ycsf build CLI action (T050)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
  });

  it('AC1: build succeeds → exit 0, summary apps+artifacts', async () => {
    const project = new Map([['a', {}], ['b', {}]]);
    mockBuildApps.mockResolvedValue({
      kind: 'ok',
      projectModel: { apps: project } as never,
      registry: { records: new Map() } as never,
      artifacts: [{ appId: 'a', artifact: { type: 't', value: {} } }, { appId: 'b', artifact: { type: 't', value: {} } }],
    });
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await buildAction(fakeCmd({ json: true }));
    expect(process.exitCode).toBe(ExitCode.Success);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0] ?? ''));
    expect(json.summary?.apps).toBe(2);
    expect(json.summary?.artifacts).toBe(2);
    spy.mockRestore();
  });

  it('AC2: build fails with ENV not set → exit 1, PML_ENV_NOT_SET', async () => {
    mockBuildApps.mockResolvedValue({
      kind: 'invalid',
      errors: [{ code: 'PML_ENV_NOT_SET', message: 'env not set', file: '.ycsf/apps.yaml' } as never],
    });
    await buildAction(fakeCmd());
    expect(process.exitCode).toBe(ExitCode.Error);
  });

  it('unknown app target → CLI_APP_NOT_FOUND → exit 2', async () => {
    mockBuildApps.mockResolvedValue({
      kind: 'invalid',
      errors: [{ code: 'CLI_APP_NOT_FOUND', message: 'not found', file: '.ycsf/apps.yaml' } as never],
    });
    await buildAction(fakeCmd({ target: 'unknown' }));
    expect(process.exitCode).toBe(ExitCode.InputError);
  });

  it('FR-009: progress to stderr when json=false', async () => {
    mockBuildApps.mockResolvedValue({
      kind: 'ok',
      projectModel: { apps: new Map() } as never,
      registry: { records: new Map() } as never,
      artifacts: [],
    });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await buildAction(fakeCmd());
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
