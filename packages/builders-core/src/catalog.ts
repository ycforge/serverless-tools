/**
 * Artifact catalog (FR-003): builder id → artifact type + importable subpath.
 * Forward contract for 019/021 dispatch (`@ycforge/builders-core/*` subpaths
 * resolve as US4 registry entries). Unknown ids intentionally return nothing.
 */

import type { ArtifactType } from './types.js';

export interface CatalogEntry {
  readonly id: 'nestjs-function' | 'docker' | 'vite';
  readonly package: '@ycforge/builders-core';
  readonly modulePath: string;
  readonly artifactType: ArtifactType;
}

export const catalog: readonly CatalogEntry[] = Object.freeze([
  {
    id: 'nestjs-function',
    package: '@ycforge/builders-core',
    modulePath: '@ycforge/builders-core/nestjs-function',
    artifactType: 'ycforge:function',
  },
  {
    id: 'docker',
    package: '@ycforge/builders-core',
    modulePath: '@ycforge/builders-core/docker',
    artifactType: 'ycforge:docker-image',
  },
  {
    id: 'vite',
    package: '@ycforge/builders-core',
    modulePath: '@ycforge/builders-core/vite',
    artifactType: 'ycforge:frontend',
  },
]);