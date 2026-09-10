import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/cli/prompt.js', () => ({
  confirmDestroy: vi.fn(),
}));
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return { ...actual, spawn: vi.fn(), spawnSync: vi.fn() };
});

import * as child_process from 'child_process';
import { destroyAction } from '../../../src/cli/destroy.js';
import { confirmDestroy } from '../../../src/cli/prompt.js';
import { ExitCode, DestroyRequiresYesError } from '../../../src/cli/errors.js';

const mockSpawn = vi.mocked(child_process.spawn);
const mockSpawnSync = vi.mocked(child_process.spawnSync);

function fakeCmd(opts: Record<string, unknown> = {}) {
  return {
    optsWithGlobals: () => ({ projectDir: '/root', json: true, yes: false, cleanup: false, ...opts }),
  } as never;
}

/** findTerraform probe: terraform present on PATH. */
function terraformProbe(): never {
  return { status: 0, stdout: 'terraform\n', stderr: '', pid: 1, signal: null } as never;
}

/** A fake child that emits a single stdout chunk then exits 0. */
function okChild(stdout = ''): never {
  return {
    stdout: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from(stdout));
      }),
    },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (code: number | null) => void) => {
      if (event === 'close') cb(0);
    }),
    kill: vi.fn(),
    killed: false,
  } as never;
}

describe('ycsf destroy action (T100)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    mockSpawnSync.mockReturnValue(terraformProbe());
  });

  it('AC1: destroy --yes → exit 0, terraform destroy with autoApprove', async () => {
    mockSpawn.mockReturnValueOnce(okChild('Terraform initialized.')).mockReturnValue(okChild('Destroy complete!'));
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await destroyAction(fakeCmd({ yes: true }));
    expect(process.exitCode).toBe(ExitCode.Success);
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['destroy', '-auto-approve', '-no-color']),
      expect.objectContaining({ cwd: '/root/infra' }),
    );
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.summary?.tfDestroyOutput).toContain('Destroy complete!');
    spy.mockRestore();
  });

  it('AC3: non-TTY → exit 2', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true });
    vi.mocked(confirmDestroy).mockRejectedValue(new DestroyRequiresYesError());
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await destroyAction(fakeCmd({ yes: false }));
    expect(process.exitCode).toBe(ExitCode.InputError);
    spy.mockRestore();
  });

  it('AC4: --cleanup → cleanup called after destroy', async () => {
    vi.mocked(confirmDestroy).mockResolvedValue(true);
    mockSpawn.mockReturnValueOnce(okChild('Terraform initialized.')).mockReturnValue(okChild('Destroy complete!'));
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await destroyAction(fakeCmd({ yes: true, cleanup: true }));
    expect(process.exitCode).toBe(ExitCode.Success);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.summary?.cleanedUp).toBe(true);
    spy.mockRestore();
  });

  it('AC5: SIGINT during runTerraform → child killed, exit 130', async () => {
    vi.useFakeTimers();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const killMock = vi.fn();
    const hangingChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: killMock,
    };
    mockSpawn.mockReturnValueOnce(okChild('Terraform initialized.')).mockReturnValue(hangingChild as never);
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const pending = destroyAction(fakeCmd({ yes: true }));
    // flush the init→destroy handshake so the SIGINT listener is registered
    for (let i = 0; i < 10; i++) await Promise.resolve();

    process.emit('SIGINT');
    expect(killMock).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(2000);
    expect(killMock).toHaveBeenCalledWith('SIGKILL');
    expect(exitSpy).toHaveBeenCalledWith(130);

    // destroyAction swallows the RuntimeError and reports CLI_TERRAFORM_FAILED.
    await pending;
    expect(process.exitCode).toBe(ExitCode.Error);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.diagnostics[0]?.code).toBe('CLI_TERRAFORM_FAILED');

    process.removeAllListeners('SIGINT');
    vi.useRealTimers();
    exitSpy.mockRestore();
    spy.mockRestore();
  });
});