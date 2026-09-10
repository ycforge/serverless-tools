import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/model/loader.js', () => ({
  loadProjectModel: vi.fn(),
}));
vi.mock('../../../src/registry/index.js', () => ({
  loadRegistry: vi.fn(),
}));
vi.mock('../../../src/materialize/dispatch.js', () => ({
  dispatch: vi.fn(),
}));
vi.mock('../../../src/extensions/index.js', () => ({
  loadExtensions: vi.fn(),
  applyExtensions: vi.fn(),
}));
vi.mock('../../../src/materialize/write.js', () => ({
  writeGeneratedTerraform: vi.fn(),
}));

import { materializeAction } from '../../../src/cli/materialize.js';
import { loadProjectModel } from '../../../src/model/loader.js';
import { loadRegistry } from '../../../src/registry/index.js';
import { dispatch } from '../../../src/materialize/dispatch.js';
import { loadExtensions } from '../../../src/extensions/index.js';
import { writeGeneratedTerraform } from '../../../src/materialize/write.js';
import { ExitCode } from '../../../src/cli/errors.js';

function fakeCmd(opts: Record<string, unknown> = {}) {
  return {
    optsWithGlobals: () => ({ projectDir: '/root', json: true, ...opts }),
  } as never;
}

describe('ycsf materialize action (T060)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.mocked(writeGeneratedTerraform).mockResolvedValue();
    vi.mocked(loadExtensions).mockImplementation(() => { throw new Error('no ext'); });
  });

  it('AC1: materialize succeeds → exit 0, summary files', async () => {
    const model = { apps: new Map([['a', { app_id: 'a' }]]) } as never;
    vi.mocked(loadProjectModel).mockReturnValue({ kind: 'ok', model });
    vi.mocked(loadRegistry).mockResolvedValue({ kind: 'ok', registry: { records: new Map() } });
    vi.mocked(dispatch).mockResolvedValue({
      kind: 'ok', resources: [],
      generatedFiles: [{ filename: 'a.ycsf.tf.json', content: '{}' }],
    });
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await materializeAction(fakeCmd());
    expect(process.exitCode).toBe(ExitCode.Success);
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.summary?.files).toBe(1);
    spy.mockRestore();
  });

  it('AC2: dispatch error → exit 1', async () => {
    const model = { apps: new Map([['a', { app_id: 'a' }]]) } as never;
    vi.mocked(loadProjectModel).mockReturnValue({ kind: 'ok', model });
    vi.mocked(loadRegistry).mockResolvedValue({ kind: 'ok', registry: { records: new Map() } });
    vi.mocked(dispatch).mockResolvedValue({
      kind: 'invalid',
      errors: [{ code: 'YCK_MISSING_TARGET', message: 'target missing' }],
    });
    await materializeAction(fakeCmd());
    expect(process.exitCode).toBe(ExitCode.Error);
  });

  it('AC3: --target user_service → only user_service files written', async () => {
    const model = {
      apps: new Map([
        ['user_service', { app_id: 'user_service' }],
        ['analytics', { app_id: 'analytics' }],
      ]),
    } as never;
    vi.mocked(loadProjectModel).mockReturnValue({ kind: 'ok', model });
    vi.mocked(loadRegistry).mockResolvedValue({ kind: 'ok', registry: { records: new Map() } });
    vi.mocked(dispatch).mockResolvedValue({
      kind: 'ok',
      resources: [],
      generatedFiles: [
        { filename: 'user_service.ycsf.tf.json', content: '{}' },
        { filename: 'analytics.ycsf.tf.json', content: '{}' },
      ],
    });
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await materializeAction(fakeCmd({ target: 'user_service' }));
    expect(process.exitCode).toBe(ExitCode.Success);
    const written = (vi.mocked(writeGeneratedTerraform).mock.calls[0]?.[1] ?? []) as Array<{
      filename: string;
      content: string;
    }>;
    const filenames = written.map((f) => f.filename);
    expect(filenames).toContain('user_service.ycsf.tf.json');
    expect(filenames).not.toContain('analytics.ycsf.tf.json');
    const json = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(json.summary?.files).toBe(1);
    spy.mockRestore();
  });
});
