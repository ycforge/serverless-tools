import { describe, expectTypeOf, it } from 'vitest';

import {
  ARTIFACT_CATALOG,
  ARTIFACT_TYPES,
  MATERIALIZER_IDS,
  YMT_EMPTY_DIRECTORY,
  YMT_INVALID_ARTIFACT_VALUE,
  YMT_INVALID_QUEUE_URL,
  type ArtifactType,
  type MaterializerId,
} from '@ycforge/materializers-core';
import type {
  ApiGatewayArtifactValue,
  Artifact,
  DockerArtifactValue,
  FrontendArtifactValue,
  FunctionArtifactValue,
  MaterializationContext,
  Materializer,
  OutputBuilder,
  QueueArtifactValue,
  ResourceReference,
  TerraformResource,
} from '@ycforge/materializers-core';
import yandexApiGateway from '@ycforge/materializers-core/yandex-api-gateway';
import yandexFunction from '@ycforge/materializers-core/yandex-function';
import yandexMessageQueue from '@ycforge/materializers-core/yandex-message-queue';
import yandexServerlessContainer from '@ycforge/materializers-core/yandex-serverless-container';
import yandexStorageBucket from '@ycforge/materializers-core/yandex-storage-bucket';

// Standalone type-level contract of @ycforge/materializers-core (DQ-6): the
// public API owns types/catalog/diagnostics and every subpath module
// default-exports a spec-002 Materializer shape (FR-001/FR-003, additive
// multi-resource return D-RE-5).

type ArtifactTypesEntry = (typeof ARTIFACT_TYPES)[number];

describe('materializers-core type-level contract (FR-001/003, D-3, D-RE-5)', () => {
  it('ArtifactType is exactly the 5-literal union incl. D-3 forward contracts', () => {
    expectTypeOf<ArtifactType>().toEqualTypeOf<
      'ycforge:function' | 'ycforge:docker-image' | 'ycforge:api-gateway' | 'ycforge:queue' | 'ycforge:frontend'
    >();
    expectTypeOf(MATERIALIZER_IDS).toMatchTypeOf<readonly MaterializerId[]>();
    expectTypeOf<MaterializerId>().toEqualTypeOf<
      'yandex-function' | 'yandex-serverless-container' | 'yandex-api-gateway' | 'yandex-message-queue' | 'yandex-storage-bucket'
    >();
  });

  it('catalog keys are materializer ids and artifact declarations are ArtifactTypes', () => {
    expectTypeOf(MATERIALIZER_IDS).toMatchTypeOf<readonly string[]>();
    expectTypeOf(ARTIFACT_CATALOG['yandex-function'].artifactType).toEqualTypeOf<'ycforge:function'>();
    expectTypeOf<ArtifactTypesEntry>().toEqualTypeOf<ArtifactType>();
  });

  it('YMT_* constants are exported from the root', () => {
    expectTypeOf(YMT_INVALID_QUEUE_URL).toBeString();
    expectTypeOf(YMT_INVALID_ARTIFACT_VALUE).toBeString();
    expectTypeOf(YMT_EMPTY_DIRECTORY).toBeString();
  });

  it('each subpath module default-exports a spec-002 Materializer shape', () => {
    expectTypeOf(yandexFunction).toMatchTypeOf<Materializer>();
    expectTypeOf(yandexServerlessContainer).toMatchTypeOf<Materializer>();
    expectTypeOf(yandexApiGateway).toMatchTypeOf<Materializer>();
    expectTypeOf(yandexMessageQueue).toMatchTypeOf<Materializer>();
    expectTypeOf(yandexStorageBucket).toMatchTypeOf<Materializer>();
  });

  it('materialize resolves to a TerraformResource or a readonly array (additive multi-resource)', () => {
    type Single = Awaited<ReturnType<typeof yandexFunction.materialize>>;
    type Multi = Awaited<ReturnType<typeof yandexStorageBucket.materialize>>;
    expectTypeOf<Single>().toEqualTypeOf<TerraformResource | readonly TerraformResource[]>();
    expectTypeOf<Multi>().toEqualTypeOf<TerraformResource | readonly TerraformResource[]>();
  });

  it('artifact value shapes are structurally typed (incl. D-3 forward contracts)', () => {
    const f: FunctionArtifactValue = { archivePath: 'build/function.zip', entryPoint: 'index.handler' };
    const d: DockerArtifactValue = { image: 'cr.example/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
    const v: FrontendArtifactValue = { directory: '/x/out' };
    const ref: ResourceReference = { logical: 'functions.user_service', terraformType: 'yandex_function' };
    const g: ApiGatewayArtifactValue = { specPath: '/x/openapi.yaml', resourceReferences: [ref] };
    const q: QueueArtifactValue = { queueUrl: 'https://message-queue.api.cloud.yandex.net/b1g1/queues/my-queue' };
    expectTypeOf(f.archivePath).toBeString();
    expectTypeOf(f.entryPoint).toBeString();
    expectTypeOf(d.image).toBeString();
    expectTypeOf(v.directory).toBeString();
    expectTypeOf(g.specPath).toBeString();
    expectTypeOf(g.resourceReferences).toMatchTypeOf<readonly ResourceReference[]>();
    expectTypeOf(q.queueUrl).toBeString();
  });

  it('standalone core shapes are structurally compatible with the caller expectations', () => {
    const artifact: Artifact = { type: 'ycforge:function', value: { archivePath: 'x', entryPoint: 'y' } };
    const output: OutputBuilder = { declare: (_name, _output) => {} };
    const context: MaterializationContext = { output };
    expectTypeOf(yandexFunction.supports(artifact, context)).toBeBoolean();
    expectTypeOf(output.declare).toBeFunction();
  });
});