import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import { spawnTerraform, findTerraform } from '../../../src/cli/terraform.js';

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
});
