import { describe, expect, it } from 'vitest';

import { PML_INVALID } from '../../src/contracts/index.js';
import { extractApps } from '../../src/model/apps.js';
import { parseYaml } from '../../src/model/parse.js';
import type { AppsResult } from '../../src/model/apps.js';

// US-1 AC1 / FR-001: apps.yaml → App records (app_id, source_path, builder,
// depends_on). FR-012: no builder-specific keys in apps.yaml.
// Layout-level only: unknown `builder` values are NOT load errors (spec 013).

const VALID_APPS = `version: 1
apps:
  user_service:
    source_path: user_service
    builder: nestjs-function
  analytics:
    source_path: analytics
    builder: docker
    depends_on:
      - user_service
  frontend:
    source_path: frontend
    builder: vite
    depends_on:
      - user_service
`;

function parseApps(text: string, file = '.ycsf/apps.yaml'): AppsResult {
  const parsed = parseYaml(text, file);
  if (parsed.kind !== 'ok') {
    return { kind: 'invalid', errors: parsed.errors };
  }
  return extractApps(parsed.data, file);
}

function diagnosticsOf(result: AppsResult) {
  return result.kind === 'invalid' ? result.errors : [];
}

describe('extractApps (US-1, FR-001)', () => {
  it('parses 3 apps with source_path, builder, depends_on', () => {
    const result = parseApps(VALID_APPS);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.apps).toHaveLength(3);
    const byId = new Map(result.apps.map((app) => [app.app_id, app]));
    expect(byId.get('user_service')).toEqual({
      app_id: 'user_service',
      source_path: 'user_service',
      builder: 'nestjs-function',
      depends_on: [],
    });
    expect(byId.get('analytics')).toMatchObject({
      source_path: 'analytics',
      builder: 'docker',
      depends_on: ['user_service'],
    });
    expect(byId.get('frontend')).toMatchObject({
      builder: 'vite',
      depends_on: ['user_service'],
    });
  });

  it('treats a missing depends_on as an empty array', () => {
    const result = parseApps(
      'version: 1\napps:\n  solo:\n    source_path: solo\n    builder: docker\n',
    );
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.apps[0]).toMatchObject({ app_id: 'solo', depends_on: [] });
  });
});

describe('extractApps — shape validation (FR-012, data-model validation rules)', () => {
  it('rejects builder-specific / unknown per-app keys with PML_INVALID', () => {
    const result = parseApps(
      'version: 1\napps:\n  evil:\n    source_path: evil\n    builder: docker\n    dockerfile: Dockerfile\n',
    );
    expect(result.kind).toBe('invalid');
    const diagnostics = diagnosticsOf(result);
    expect(diagnostics[0]).toMatchObject({
      code: PML_INVALID,
      file: '.ycsf/apps.yaml',
      app: 'evil',
    });
  });

  it('rejects a non-string depends_on entry with PML_INVALID', () => {
    const result = parseApps(
      'version: 1\napps:\n  a:\n    source_path: a\n    builder: docker\n    depends_on:\n      - 42\n',
    );
    const diagnostics = diagnosticsOf(result);
    expect(diagnostics[0]?.code).toBe(PML_INVALID);
  });

  it('rejects a non-array depends_on with PML_INVALID', () => {
    const result = parseApps(
      'version: 1\napps:\n  a:\n    source_path: a\n    builder: docker\n    depends_on: user_service\n',
    );
    const diagnostics = diagnosticsOf(result);
    expect(diagnostics[0]?.code).toBe(PML_INVALID);
    expect(diagnostics[0]?.field).toBe('depends_on');
  });

  it('rejects a missing builder with PML_INVALID', () => {
    const result = parseApps(
      'version: 1\napps:\n  a:\n    source_path: a\n    depends_on: []\n',
    );
    const diagnostics = diagnosticsOf(result);
    expect(diagnostics[0]?.code).toBe(PML_INVALID);
    expect(diagnostics[0]?.field).toBe('builder');
  });

  it('rejects a missing source_path with PML_INVALID', () => {
    const result = parseApps(
      'version: 1\napps:\n  a:\n    builder: docker\n',
    );
    const diagnostics = diagnosticsOf(result);
    expect(diagnostics[0]?.code).toBe(PML_INVALID);
    expect(diagnostics[0]?.field).toBe('source_path');
  });

  it('does NOT reject an unknown builder value at load (deferred spec 013)', () => {
    const result = parseApps(
      'version: 1\napps:\n  a:\n    source_path: a\n    builder: made-up-builder\n',
    );
    expect(result.kind).toBe('ok');
  });
});