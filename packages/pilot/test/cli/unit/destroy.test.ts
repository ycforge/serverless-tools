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

  it('AC4: --cleanup → removes infra files, cleanedUp true when files removed', async () => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'pilot-destroy-ac4-'));
    mkdirSync(join(root, 'infra'), { recursive: true });
    writeFileSync(join(root, 'infra', 'user_service.ycsf.tf.json'), '{}');

    vi.mocked(confirmDestroy).mockResolvedValue(true);
    mockSpawn.mockReturnValueOnce(okChild('Terraform initialized.')).mockReturnValue(okChild('Destroy complete!'));
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await destroyAction(fakeCmd({ projectDir: root, yes: true, cleanup: true }));
    expect(process.exitCode).toBe(ExitCode.Success);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.summary?.cleanedUp).toBe(true);
    spy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });

  it('T155: --cleanup with nothing to remove → cleanedUp false', async () => {
    const { mkdirSync, mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'pilot-destroy-t155-'));
    mkdirSync(join(root, 'infra'), { recursive: true });

    vi.mocked(confirmDestroy).mockResolvedValue(true);
    mockSpawn.mockReturnValueOnce(okChild('Terraform initialized.')).mockReturnValue(okChild('Destroy complete!'));
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await destroyAction(fakeCmd({ projectDir: root, yes: true, cleanup: true }));
    expect(process.exitCode).toBe(ExitCode.Success);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.summary?.cleanedUp).toBe(false);
    spy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });

  it('AC5: SIGINT during runTerraform → child SIGTERM, SIGKILL backstop, exit(130)', async () => {
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

    destroyAction(fakeCmd({ yes: true }));
    // flush the init→destroy handshake so the SIGINT listener is registered
    for (let i = 0; i < 10; i++) await Promise.resolve();

    process.emit('SIGINT');
    expect(killMock).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(2000);
    expect(killMock).toHaveBeenCalledWith('SIGKILL');
    expect(exitSpy).toHaveBeenCalledWith(130);

    process.removeAllListeners('SIGINT');
    vi.useRealTimers();
    exitSpy.mockRestore();
  });

  it('T152: --cleanup removes generated terraform files from infra/, not .ycsf/', async () => {
    const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'pilot-destroy-cleanup-'));
    mkdirSync(join(root, 'infra'), { recursive: true });
    mkdirSync(join(root, '.ycsf'), { recursive: true });
    const infraFiles = [
      'user_service.ycsf.tf.json',
      '99-ycsf-outputs.tf.json',
      'keep.tf.json',
    ];
    for (const f of infraFiles) writeFileSync(join(root, 'infra', f), '{}');
    writeFileSync(join(root, '.ycsf', 'user_service.ycsf.tf.json'), '{}');

    vi.mocked(confirmDestroy).mockResolvedValue(true);
    mockSpawn.mockReturnValueOnce(okChild('Terraform initialized.')).mockReturnValue(okChild('Destroy complete!'));
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await destroyAction({ optsWithGlobals: () => ({ projectDir: root, json: true, yes: true, cleanup: true }) } as never);
    expect(process.exitCode).toBe(ExitCode.Success);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.summary?.cleanedUp).toBe(true);

    const { readdirSync } = await import('node:fs');
    const remainingInfra = readdirSync(join(root, 'infra'));
    expect(remainingInfra).toEqual(['keep.tf.json']);
    // Build cache (.ycsf/) is NOT touched by --cleanup.
    expect(readdirSync(join(root, '.ycsf'))).toEqual(['user_service.ycsf.tf.json']);

    spy.mockRestore();
    rmSync(root, { recursive: true, force: true });
  });
});