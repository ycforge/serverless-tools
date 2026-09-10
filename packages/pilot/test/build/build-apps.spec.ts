import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all library functions
vi.mock('../../src/model/loader.js', () => ({
  loadProjectModel: vi.fn(),
}));
vi.mock('../../src/build-env/index.js', () => ({
  prepareBuildEnv: vi.fn(),
}));
vi.mock('../../src/registry/index.js', () => ({
  loadRegistry: vi.fn(),
  validateBuilders: vi.fn(),
}));
vi.mock('../../src/registry/shape.js', () => ({
  getBuilder: vi.fn(),
  isBuilderShape: vi.fn(),
}));

import { buildApps } from '../../src/build/index.js';
import { loadProjectModel } from '../../src/model/loader.js';
import { prepareBuildEnv } from '../../src/build-env/index.js';
import { loadRegistry, validateBuilders } from '../../src/registry/index.js';
import { getBuilder } from '../../src/registry/shape.js';
import { CLI_MISSING_PROJECT_DIR, CLI_APP_NOT_FOUND } from '../../src/cli/errors.js';

const mockLoadProjectModel = vi.mocked(loadProjectModel);
const mockPrepareBuildEnv = vi.mocked(prepareBuildEnv);
const mockLoadRegistry = vi.mocked(loadRegistry);
const mockValidateBuilders = vi.mocked(validateBuilders);
const mockGetBuilder = vi.mocked(getBuilder);

function fakeApp(appId: string, builder: string) {
  return { app_id: appId, source_path: `src/${appId}`, builder, depends_on: [] };
}

function fakeProject(appIds: string[], builderId = 'nodejs-builder') {
  const apps = new Map(appIds.map((id) => [id, fakeApp(id, builderId)]));
  const build_configs = new Map(appIds.map((id) => [id, { build_config: {}, build_env: {} }]));
  return {
    apps,
    resources: new Map(),
    build_configs,
    env_requirements: new Map(),
    depends_on_graph: { adjacency: new Map(), topologicalOrder: [...appIds] },
  };
}

function fakeRegistry(builderIds: string[]) {
  return {
    records: new Map(
      builderIds.map((id) => [id, { id, packageName: `pkg-${id}`, kind: 'builder' as const, module: { build: vi.fn() } }]),
    ),
  };
}

describe('buildApps (T026)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepareBuildEnv.mockImplementation((_appId: string, _config: unknown) => ({
      kind: 'ok',
      resolvedEnv: {},
      buildConfig: {},
    }));
    mockValidateBuilders.mockReturnValue({ kind: 'ok' });
  });

  it('valid 2-app project → kind:"ok", 2 artifacts', async () => {
    const project = fakeProject(['user_service', 'analytics']);
    mockLoadProjectModel.mockReturnValue({ kind: 'ok', model: project });
    mockLoadRegistry.mockResolvedValue({ kind: 'ok', registry: fakeRegistry(['nodejs-builder']) });
    mockGetBuilder.mockImplementation((module: unknown) => module as never);

    const result = await buildApps('/root');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts.map((a) => a.appId).sort()).toEqual(['analytics', 'user_service']);
  });

  it('loadProjectModel throws → CLI_MISSING_PROJECT_DIR', async () => {
    mockLoadProjectModel.mockImplementation(() => { throw new Error('missing .ycsf/apps.yaml'); });
    const result = await buildApps('/missing');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    expect(result.errors[0]?.code).toBe(CLI_MISSING_PROJECT_DIR);
  });

  it('prepareBuildEnv error → kind:"invalid" with PML_ENV_NOT_SET', async () => {
    mockLoadProjectModel.mockReturnValue({ kind: 'ok', model: fakeProject(['app1']) });
    mockPrepareBuildEnv.mockReturnValue({
      kind: 'invalid',
      errors: [{ code: 'PML_ENV_NOT_SET', message: 'env not set', file: 'app1/build_config.yaml' }],
    });
    const result = await buildApps('/root');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    expect(result.errors.some((e) => e.code === 'PML_ENV_NOT_SET')).toBe(true);
  });

  it('unknown builder → BRG_UNKNOWN_BUILDER', async () => {
    const project = fakeProject(['app1']);
    mockLoadProjectModel.mockReturnValue({ kind: 'ok', model: project });
    mockLoadRegistry.mockResolvedValue({ kind: 'ok', registry: fakeRegistry([]) });
    mockValidateBuilders.mockReturnValue({
      kind: 'invalid',
      errors: [{ code: 'BRG_UNKNOWN_BUILDER', message: 'unknown builder', file: '.ycsf/apps.yaml' }],
    });
    const result = await buildApps('/root');
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    expect(result.errors.some((e) => e.code === 'BRG_UNKNOWN_BUILDER')).toBe(true);
  });

  it('--target valid app → 1 artifact', async () => {
    const project = fakeProject(['user_service', 'analytics']);
    mockLoadProjectModel.mockReturnValue({ kind: 'ok', model: project });
    mockLoadRegistry.mockResolvedValue({ kind: 'ok', registry: fakeRegistry(['nodejs-builder']) });
    mockGetBuilder.mockImplementation((module: unknown) => module as never);
    const result = await buildApps('/root', { target: 'user_service' });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]?.appId).toBe('user_service');
  });

  it('--target unknown app → CLI_APP_NOT_FOUND', async () => {
    const project = fakeProject(['user_service']);
    mockLoadProjectModel.mockReturnValue({ kind: 'ok', model: project });
    mockLoadRegistry.mockResolvedValue({ kind: 'ok', registry: fakeRegistry([]) });
    const result = await buildApps('/root', { target: 'unknown_app' });
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    expect(result.errors[0]?.code).toBe(CLI_APP_NOT_FOUND);
  });

  it('empty project (0 apps) → kind:"ok", 0 artifacts', async () => {
    mockLoadProjectModel.mockReturnValue({ kind: 'ok', model: fakeProject([]) });
    mockLoadRegistry.mockResolvedValue({ kind: 'ok', registry: fakeRegistry([]) });
    const result = await buildApps('/root');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.artifacts).toHaveLength(0);
  });
});
