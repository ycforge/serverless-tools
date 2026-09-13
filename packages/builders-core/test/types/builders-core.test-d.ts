import { describe, expectTypeOf, it } from 'vitest';

import {
  ARTIFACT_TYPES,
  type Artifact,
  type ArtifactType,
  type Builder,
  type BuildContext,
  type DockerArtifactValue,
  type DockerBuildConfig,
  type FrontendArtifactValue,
  type FunctionArtifactValue,
} from '../../src/types.js';
import { catalog, type CatalogEntry } from '../../src/catalog.js';
import nestjsFunctionBuilder from '../../src/nestjs-function/index.js';
import dockerBuilder from '../../src/docker/index.js';
import viteBuilder from '../../src/vite/index.js';

// FR-001/003/004 type-level guarantees: builders are Builder-shaped, artifact
// values are typed per artifact type, catalog artifact types are the closed
// ArtifactType union.

describe('builders-core type-level contract (FR-001/003/004)', () => {
  it('each subpath module default-exports a spec-002 Builder shape', () => {
    expectTypeOf(nestjsFunctionBuilder).toMatchTypeOf<Builder>();
    expectTypeOf(dockerBuilder).toMatchTypeOf<Builder>();
    expectTypeOf(viteBuilder).toMatchTypeOf<Builder>();
  });

  it('build() accepts BuildContext and resolves a typed Artifact', () => {
    type FnResult = Awaited<ReturnType<typeof nestjsFunctionBuilder.build>>;
    type ViteResult = Awaited<ReturnType<typeof viteBuilder.build>>;
    expectTypeOf<FnResult>().toEqualTypeOf<Artifact<FunctionArtifactValue>>();
    expectTypeOf<ViteResult>().toEqualTypeOf<Artifact<FrontendArtifactValue>>();
  });

  it('Artifact types honour the <scope>:<kind> convention', () => {
    expectTypeOf<ArtifactType>().toEqualTypeOf<
      'ycforge:function' | 'ycforge:docker-image' | 'ycforge:frontend'
    >();
    expectTypeOf(ARTIFACT_TYPES).toMatchTypeOf<readonly string[]>();
    expectTypeOf(ARTIFACT_TYPES[0]!).toEqualTypeOf<ArtifactType>();
  });

  it('artifact values are structurally typed', () => {
    const f: FunctionArtifactValue = { archivePath: '/x/fn.zip', entryPoint: 'main.handler' };
    const d: DockerArtifactValue = { image: 'cr.example/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' };
    const v: FrontendArtifactValue = { directory: '/x/out' };
    expectTypeOf(f.archivePath).toBeString();
    expectTypeOf(f.entryPoint).toBeString();
    expectTypeOf(d.image).toBeString();
    expectTypeOf(v.directory).toBeString();
  });

  it('catalog artifact types are the closed ArtifactType union', () => {
    const entry: CatalogEntry = catalog[0]!;
    expectTypeOf(entry.artifactType).toMatchTypeOf<ArtifactType>();
    expectTypeOf<ArtifactType>().toEqualTypeOf<
      'ycforge:function' | 'ycforge:docker-image' | 'ycforge:frontend'
    >();
  });
});

describe('DockerBuildConfig additive no_push, frozen value.image (spec 027)', () => {
  it('image.no_push is optional: with and without it both assignable (FR-001/FR-008)', () => {
    const withNoPush: DockerBuildConfig = { image: { repository: 'r', tag: 'v1', no_push: true } };
    const withoutNoPush: DockerBuildConfig = { image: { repository: 'r' } };
    expectTypeOf(withNoPush).toMatchTypeOf<DockerBuildConfig>();
    expectTypeOf(withoutNoPush).toMatchTypeOf<DockerBuildConfig>();
  });

  it('image section is exactly { repository, tag?, no_push? } (additivity, SC-007)', () => {
    expectTypeOf<DockerBuildConfig['image']>().toEqualTypeOf<
      { readonly repository: string; readonly tag?: string; readonly no_push?: boolean } | undefined
    >();
  });

  it('no_push is strictly boolean: string/number never match the image section (FR-006)', () => {
    type DockerImageSection = NonNullable<DockerBuildConfig['image']>;
    const badString: { readonly repository: string; readonly no_push: string } = {
      repository: 'r',
      no_push: 'true',
    };
    const badNumber: { readonly repository: string; readonly no_push: number } = {
      repository: 'r',
      no_push: 1,
    };
    // @ts-expect-error { no_push: string } must not be assignable to the image section (FR-006)
    const _noString: DockerImageSection = badString;
    // @ts-expect-error { no_push: number } must not be assignable to the image section (FR-006)
    const _noNumber: DockerImageSection = badNumber;
  });

  it('DockerArtifactValue stays frozen as { readonly image: string } (SC-007/NG-1)', () => {
    expectTypeOf<DockerArtifactValue>().toEqualTypeOf<{ readonly image: string }>();
  });
});