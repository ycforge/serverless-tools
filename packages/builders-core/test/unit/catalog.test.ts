import { describe, expect, it } from 'vitest';

import { catalog, type CatalogEntry } from '../../src/catalog.js';

describe('artifact catalog (FR-003/FR-004, Sc1/Sc4/Sc5)', () => {
  it('maps the three builder ids in order nestjs-function → docker → vite', () => {
    expect(catalog.map((e) => e.id)).toEqual(['nestjs-function', 'docker', 'vite']);
  });

  it.each<[string, string, string]>([
    ['nestjs-function', 'ycforge:function', '@ycforge/builders-core/nestjs-function'],
    ['docker', 'ycforge:docker-image', '@ycforge/builders-core/docker'],
    ['vite', 'ycforge:frontend', '@ycforge/builders-core/vite'],
  ])('%s → artifact type %s, module %s', (id, artifactType, modulePath) => {
    const entry: CatalogEntry | undefined = catalog.find((e) => e.id === id);
    expect(entry).toBeDefined();
    expect(entry?.artifactType).toBe(artifactType);
    expect(entry?.modulePath).toBe(modulePath);
  });

  it('each entry carries the package and an importable module path', () => {
    for (const entry of catalog) {
      expect(entry.package).toBe('@ycforge/builders-core');
      expect(entry.modulePath.startsWith('@ycforge/builders-core/')).toBe(true);
    }
  });
});