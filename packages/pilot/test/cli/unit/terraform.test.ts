import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { spawnTerraform, findTerraform } from '../../../src/cli/terraform.js';
import { CLI_TERRAFORM_FAILED } from '../../../src/cli/errors.js';

// Mock child_process.spawnSync for findTerraform
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn(),
    spawn: vi.fn(),
  };
});

import * as child_process from 'child_process';

const mockSpawnSync = vi.mocked(child_process.spawnSync);
const mockSpawn = vi.mocked(child_process.spawn);

describe('spawnTerraform (T031)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findTerraform throws when terraform not in PATH', () => {
    const probe: Partial<SpawnSyncReturns<string>> = { status: 1, stdout: '', stderr: '', pid: 0, signal: null };
    mockSpawnSync.mockReturnValue(probe as SpawnSyncReturns<string>);
    expect(() => findTerraform()).toThrow();
  });

  it('spawnTerraform("init") spawns with correct args', async () => {
    const probe = {
      status: 0,
      stdout: '/usr/local/bin/terraform\n',
      stderr: '',
      pid: 1,
      signal: null,
    } as unknown as SpawnSyncReturns<string>;
    mockSpawnSync.mockReturnValue(probe);
    const fakeChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') cb(0);
      }),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(fakeChild as never);
    const result = await spawnTerraform('init', '/root');
    expect(result.exitCode).toBe(0);
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['init', '-no-color']),
      expect.objectContaining({ cwd: '/root/infra' }),
    );
  });

  it('SIGINT → SIGTERM immediately, SIGKILL backstop after 2s, exit(130)', async () => {
    vi.useFakeTimers();
    const probe = {
      status: 0,
      stdout: '/usr/local/bin/terraform\n',
      stderr: '',
      pid: 1,
      signal: null,
    } as unknown as SpawnSyncReturns<string>;
    mockSpawnSync.mockReturnValue(probe);
    const killMock = vi.fn();
    const fakeChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
      kill: killMock,
    };
    mockSpawn.mockReturnValue(fakeChild as never);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    spawnTerraform('plan', '/root');
    process.emit('SIGINT');
    expect(killMock).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(2000);
    expect(killMock).toHaveBeenCalledWith('SIGKILL');
    expect(exitSpy).toHaveBeenCalledWith(130);

    process.removeAllListeners('SIGINT');
    vi.useRealTimers();
    exitSpy.mockRestore();
  });

  it('T153: SIGINT → child closes gracefully → exit(130), NOT CLI_TERRAFORM_FAILED exit 1', async () => {
    vi.useFakeTimers();
    const probe = {
      status: 0,
      stdout: '/usr/local/bin/terraform\n',
      stderr: '',
      pid: 1,
      signal: null,
    } as unknown as SpawnSyncReturns<string>;
    mockSpawnSync.mockReturnValue(probe);
    let closeCb: ((code: number | null) => void) | undefined;
    const fakeChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') closeCb = cb;
      }),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(fakeChild as never);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    spawnTerraform('plan', '/root');
    process.emit('SIGINT');
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');

    // Child exits gracefully (e.g. 143 after SIGTERM) BEFORE the 2s backstop.
    closeCb?.(143);
    expect(exitSpy).toHaveBeenCalledWith(130);

    // Repro of the former bug: reject(CLI_TERRAFORM_FAILED) → exit 1.
    await vi.advanceTimersByTimeAsync(3000);

    process.removeAllListeners('SIGINT');
    vi.useRealTimers();
    exitSpy.mockRestore();
  });

  it('non-zero terraform exit → RuntimeError CLI_TERRAFORM_FAILED (exit 1)', async () => {
    const probe = {
      status: 0,
      stdout: '/usr/local/bin/terraform\n',
      stderr: '',
      pid: 1,
      signal: null,
    } as unknown as SpawnSyncReturns<string>;
    mockSpawnSync.mockReturnValue(probe);
    const fakeChild = {
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: (code: number | null) => void) => {
        if (event === 'close') cb(1);
      }),
      kill: vi.fn(),
    };
    mockSpawn.mockReturnValue(fakeChild as never);
    await expect(spawnTerraform('plan', '/root')).rejects.toMatchObject({
      name: 'RuntimeError',
      code: CLI_TERRAFORM_FAILED,
      exitCode: 1,
    });
  });
});
