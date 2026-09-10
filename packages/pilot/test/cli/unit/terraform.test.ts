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

  it('SIGINT → SIGTERM immediately, SIGKILL after 2s, process.exit(130)', async () => {
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

    const pending = spawnTerraform('plan', '/root');
    // Attach the rejection handler BEFORE the timer fires so the rejection is
    // never observed as unhandled in-flight (reject happens inside the timer).
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'RuntimeError',
      code: CLI_TERRAFORM_FAILED,
      exitCode: 1,
    });
    process.emit('SIGINT');
    expect(killMock).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(2000);
    expect(killMock).toHaveBeenCalledWith('SIGKILL');
    expect(exitSpy).toHaveBeenCalledWith(130);
    await rejection;

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
