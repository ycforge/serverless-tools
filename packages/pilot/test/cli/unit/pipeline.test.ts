import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/build/index.js', () => ({
  buildApps: vi.fn(),
}));
vi.mock('../../../src/materialize/dispatch.js', () => ({
  dispatch: vi.fn(),
}));
vi.mock('../../../src/extensions/index.js', () => ({
  loadExtensions: vi.fn(),
  applyExtensions: vi.fn(),
}));
vi.mock('../../../src/moves/index.js', () => ({
  loadMoves: vi.fn(),
  buildMoves: vi.fn(),
  buildMovedFile: vi.fn(),
}));
vi.mock('../../../src/outputs/index.js', () => ({
  loadOutputs: vi.fn(),
  buildOutputs: vi.fn(),
}));
vi.mock('../../../src/materialize/write.js', () => ({
  writeGeneratedTerraform: vi.fn(),
}));

import { runBuildAndMaterialize, runMaterializeGeneration } from '../../../src/cli/pipeline.js';
import { buildApps } from '../../../src/build/index.js';
import { dispatch } from '../../../src/materialize/dispatch.js';
import { writeGeneratedTerraform } from '../../../src/materialize/write.js';
import { loadExtensions } from '../../../src/extensions/index.js';
import { loadOutputs, buildOutputs } from '../../../src/outputs/index.js';
import { loadMoves, buildMoves, buildMovedFile } from '../../../src/moves/index.js';

describe('runBuildAndMaterialize pipeline (T036)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeGeneratedTerraform).mockResolvedValue();
    vi.mocked(loadMoves).mockReturnValue({ kind: 'ok', data: { version: 1, moves: [] } });
    vi.mocked(buildMoves).mockReturnValue({ kind: 'ok', moved: [] });
    vi.mocked(buildMovedFile).mockReturnValue(null);
    vi.mocked(loadOutputs).mockImplementation(() => { throw new Error('no outputs'); });
    vi.mocked(loadExtensions).mockImplementation(() => { throw new Error('no extensions'); });
  });

  it('success: buildApps ok → dispatch ok → write called', async () => {
    vi.mocked(buildApps).mockResolvedValue({
      kind: 'ok',
      projectModel: { apps: new Map() } as never,
      registry: { records: new Map() } as never,
      artifacts: [{ appId: 'a', artifact: { type: 't', value: {} } }],
    });
    vi.mocked(dispatch).mockResolvedValue({
      kind: 'ok',
      resources: [],
      generatedFiles: [{ filename: 'a.ycsf.tf.json', content: '{}' }],
      materializerOutputs: new Map(),
    });
    await runBuildAndMaterialize('/root');
    expect(writeGeneratedTerraform).toHaveBeenCalledWith('/root/infra', expect.any(Array));
  });

  it('fail-fast: buildApps fails → dispatch NOT called', async () => {
    vi.mocked(buildApps).mockResolvedValue({
      kind: 'invalid',
      errors: [{ code: 'CLI_BUILD_FAILED', message: 'fail', file: '' }],
    });
    await expect(runBuildAndMaterialize('/root')).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('T011: runMaterializeGeneration threads artifacts into dispatch and materializerOutputs into buildOutputs (FR-005/FR-006)', async () => {
    const artifacts = new Map([
      ['user_service', { type: 'ycforge:function', value: { archivePath: 'dist/func.zip', entryPoint: 'index.handler' } }],
    ]);
    const outputs = new Map<string, { value: string }>([['user_service_function_id', { value: 'yandex_function.user_service.id' }]]);
    vi.mocked(loadOutputs).mockReturnValue({ kind: 'ok', data: { version: 1, outputs: {} } });
    vi.mocked(buildOutputs).mockReturnValue({
      kind: 'ok',
      file: { filename: '99-ycsf-outputs.tf.json', content: '{"output":{}}' },
    });
    vi.mocked(dispatch).mockResolvedValue({
      kind: 'ok',
      resources: [],
      generatedFiles: [{ filename: 'a.ycsf.tf.json', content: '{}' }],
      materializerOutputs: outputs,
    });

    const model = { apps: new Map() } as never;
    const registry = { records: new Map() } as never;
    await runMaterializeGeneration('/root', model, registry, undefined, artifacts);

    expect(dispatch).toHaveBeenCalledWith(model, registry, { artifacts });
    expect(buildOutputs).toHaveBeenCalledWith(expect.objectContaining({ materializerOutputs: outputs }));
  });

  it('T011: runBuildAndMaterialize builds the AppIdArtifactMap from buildResult.artifacts and threads it (FR-005 characterization)', async () => {
    const builtArtifacts = [
      { appId: 'analytics', artifact: { type: 'ycforge:docker-image', value: { image: 'registry.example.com/analytics' } } },
      { appId: 'user_service', artifact: { type: 'ycforge:function', value: { archivePath: 'dist/user_service.zip', entryPoint: 'index.handler' } } },
    ];
    vi.mocked(buildApps).mockResolvedValue({
      kind: 'ok',
      projectModel: { apps: new Map() } as never,
      registry: { records: new Map() } as never,
      artifacts: builtArtifacts,
    });
    vi.mocked(dispatch).mockResolvedValue({
      kind: 'ok',
      resources: [],
      generatedFiles: [{ filename: 'a.ycsf.tf.json', content: '{}' }],
      materializerOutputs: new Map(),
    });

    await runBuildAndMaterialize('/root');

    expect(dispatch).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        artifacts: new Map([
          ['analytics', { type: 'ycforge:docker-image', value: { image: 'registry.example.com/analytics' } }],
          ['user_service', { type: 'ycforge:function', value: { archivePath: 'dist/user_service.zip', entryPoint: 'index.handler' } }],
        ]),
      },
    );
  });
});
