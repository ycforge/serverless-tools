import { describe, expect, it } from 'vitest';

import type { MaterializationContext } from '../../src/contracts/index.js';
import { dispatch } from '../../src/materialize/dispatch.js';
import {
  GOLDEN_USER_SERVICE_TF_JSON,
  canonicalAppsYaml,
  appsModel,
  makeMaterializer,
  makeRegistry,
  materializerEntry,
  matDocker,
  matNest,
  matVite,
  matWithOutput,
} from '../helpers/materialize-fixtures.js';

// T019–T021: dispatch.spec.ts — end-to-end pure dispatch (Sc1/4/9/12).

function canonicalModel() {
  return appsModel(canonicalAppsYaml());
}

function canonicalRegistry() {
  const nest = matNest();
  const docker = matDocker();
  const vite = matVite();
  const gateway = makeMaterializer('gateway', { supportedTypes: ['yandex-api-gateway'] });
  const registry = makeRegistry([
    materializerEntry(nest),
    materializerEntry(docker),
    materializerEntry(vite),
    materializerEntry(gateway),
  ]);
  return { registry, nest, docker, vite, gateway };
}

describe('dispatch.ts', () => {
  it('T019: canonical project emits resources + files in deterministic topo order [analytics, user_service, frontend, openapi] (Sc4, FR-008/014)', async () => {
    const { registry, gateway } = canonicalRegistry();
    const result = await dispatch(canonicalModel(), registry);

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.resources.map((r) => r.name)).toEqual(['analytics', 'user_service', 'frontend', 'openapi']);
    expect(result.resources.map((r) => r.type)).toEqual([
      'yandex_container',
      'yandex_function',
      'yandex_storage_bucket',
      'yandex_function',
    ]);

    expect(result.generatedFiles.map((f) => f.filename)).toEqual([
      'analytics.ycsf.tf.json',
      'user_service.ycsf.tf.json',
      'frontend.ycsf.tf.json',
      'openapi.ycsf.tf.json',
    ]);

    const userFile = result.generatedFiles[1];
    expect(userFile?.content).toBe(GOLDEN_USER_SERVICE_TF_JSON);

    expect(gateway.spy.count.materialize).toBe(1);
  });

  it('T020: repeated dispatch is byte-identical (Sc9, US-8)', async () => {
    const { registry } = canonicalRegistry();
    const model = canonicalModel();

    const first = await dispatch(model, registry);
    const second = await dispatch(model, registry);
    expect(first.kind).toBe('ok');
    expect(second.kind).toBe('ok');
    if (first.kind !== 'ok' || second.kind !== 'ok') return;

    expect(JSON.stringify(first.generatedFiles)).toBe(JSON.stringify(second.generatedFiles));
  });

  it('T021: every materializer gets ONE shared MaterializationContext (spec 002 { output }), in topo order', async () => {
    const { registry, nest, docker, vite, gateway } = canonicalRegistry();
    const result = await dispatch(canonicalModel(), registry);
    expect(result.kind).toBe('ok');

    const ctxs = [
      ...nest.spy.materializeCalls,
      ...docker.spy.materializeCalls,
      ...vite.spy.materializeCalls,
      ...gateway.spy.materializeCalls,
    ];
    expect(ctxs).toHaveLength(4);
    const firstCtx: MaterializationContext | undefined = ctxs[0];
    expect(firstCtx?.output).toBeDefined();

    expect(nest.spy.materializeCalls).toHaveLength(1);
    expect(docker.spy.materializeCalls).toHaveLength(1);
    expect(vite.spy.materializeCalls).toHaveLength(1);
    expect(gateway.spy.materializeCalls).toHaveLength(1);
  });

  it('T010: artifacts option threads value through to materializers and dispatchResult.materializerOutputs (FR-004/FR-002)', async () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`);
    const outputMat = matWithOutput();
    const registry = makeRegistry([materializerEntry(outputMat)]);

    const artifacts = new Map([
      ['user_service', { type: 'ycforge:function', value: { archivePath: 'dist/func.zip', entryPoint: 'index.handler' } }],
    ]);
    const result = await dispatch(model, registry, { artifacts });

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    // value reached the materializer
    expect(outputMat.spy.materializeArtifacts).toHaveLength(1);
    expect(outputMat.spy.materializeArtifacts[0]?.value).toEqual({ archivePath: 'dist/func.zip', entryPoint: 'index.handler' });

    // declared outputs surfaced
    expect(result.materializerOutputs.size).toBe(1);
    expect(result.materializerOutputs.get('url')).toEqual({ value: 'function_url(user_service)', description: 'URL' });
  });

  it('T010: no options → ok with empty materializerOutputs (US-5 backward-compat)', async () => {
    const model = appsModel(`version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
`);
    const nest = matNest();
    const result = await dispatch(model, makeRegistry([materializerEntry(nest)]));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.materializerOutputs.size).toBe(0);
  });
});