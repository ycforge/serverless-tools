import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PML_DEPENDS_CYCLE,
  PML_DEPENDS_SELF,
  PML_DEPENDS_UNKNOWN,
  PML_DUPLICATE_KEY,
  PML_ENV_NOT_SET,
  PML_IDENTITY_COLLISION,
  PML_VERSION,
  type ProjectModelDiagnostic,
} from '../../src/contracts/index.js';
import { loadProjectModel } from '../../src/index.js';
import { createTempProject, removeTempProject, type TempProject } from '../helpers/temp-project.js';

// quickstart.md Sc1–Sc10 against the real loadProjectModel. All scenarios are
// prepared in temp dirs (hermetic); env-dependent ones use vi.stubEnv so the
// suite never reads the host process.env.

const DEFAULT_APPS_YAML = `version: 1
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
  openapi:
    source_path: openapi
    builder: yandex-api-gateway
    depends_on:
      - user_service
`;

function flatDiagnostics(project: TempProject): { code: ProjectModelDiagnostic['code']; message: ProjectModelDiagnostic['message']; app?: string; identity?: string }[] {
  const result = loadProjectModel(project.root);
  if (result.kind === 'ok') {
    throw new Error('expected invalid result');
  }
  return result.errors.flatMap((error) =>
    error.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      message: diagnostic.message,
      ...(diagnostic.app !== undefined ? { app: diagnostic.app } : {}),
      ...(diagnostic.identity !== undefined ? { identity: diagnostic.identity } : {}),
    })),
  );
}

function codesOf(diagnostics: { code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code);
}

describe('project-model quickstart (Sc1–Sc10)', () => {
  let project: TempProject;

  beforeEach(() => {
    project = createTempProject();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    removeTempProject(project);
  });

  it('Sc1: valid reference project loads with { kind: "ok" } (US-1)', () => {
    project.write('.ycsf/apps.yaml', DEFAULT_APPS_YAML);
    project.write(
      '.ycsf/resources.yaml',
      `version: 1
queues:
  events: {}
buckets:
  frontend: {}
functions:
  legacy_authorizer: {}
`,
    );
    project.write(
      'user_service/build_config.yaml',
      'version: 1\nbuild_config:\n  runtime: nodejs22\n',
    );
    // analytics build_config references no env vars so Sc1 stays env-free
    project.write(
      'analytics/build_config.yaml',
      'version: 1\nbuild_config:\n  image: ghcr.io/example/analytics\n  port: 8080\n',
    );
    project.write(
      'openapi/build_config.yaml',
      'version: 1\nbuild_config:\n  spec: ./openapi.yaml\n',
    );

    const result = loadProjectModel(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.model.apps).toHaveLength(4);
    const userService = result.model.apps.get('user_service');
    expect(userService).toMatchObject({ source_path: 'user_service', builder: 'nestjs-function' });
    expect(userService?.depends_on).toEqual([]);
    expect(result.model.apps.get('analytics')?.depends_on).toEqual(['user_service']);
    expect(result.model.apps.get('frontend')?.depends_on).toEqual(['user_service']);
    expect(result.model.apps.get('openapi')?.depends_on).toEqual(['user_service']);

    expect(result.model.resources.get('queues')?.get('events')).toBeDefined();
    expect(result.model.resources.get('buckets')?.get('frontend')).toBeDefined();
    expect(result.model.resources.get('functions')?.get('legacy_authorizer')).toBeDefined();

    // frontend has NO build_config.yaml → empty BuildConfig
    expect(result.model.build_configs.get('frontend')).toEqual({
      build_config: {},
      build_env: {},
    });
    expect(result.model.build_configs.get('user_service')?.build_config).toEqual({
      runtime: 'nodejs22',
    });

    const order = [...result.model.depends_on_graph.topologicalOrder];
    const rank = (appId: string): number => {
      const i = order.indexOf(appId);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    expect(rank('user_service')).toBeLessThan(rank('analytics'));
    expect(rank('user_service')).toBeLessThan(rank('frontend'));
    expect(rank('user_service')).toBeLessThan(rank('openapi'));
  });

  it('Sc2: depends_on cycle → PML_DEPENDS_CYCLE naming the chain a → b → c → a (US-2 AC1)', () => {
    project.write(
      '.ycsf/apps.yaml',
      `version: 1
apps:
  a: { source_path: a, builder: nestjs-function, depends_on: [b] }
  b: { source_path: b, builder: nestjs-function, depends_on: [c] }
  c: { source_path: c, builder: nestjs-function, depends_on: [a] }
`,
    );
    const diagnostics = flatDiagnostics(project);
    const cycle = diagnostics.find((diagnostic) => diagnostic.code === PML_DEPENDS_CYCLE);
    expect(cycle).toBeDefined();
    expect(cycle?.message).toContain('a → b → c → a');
    expect(cycle?.app).toBeDefined();
  });

  it('Sc3: self-reference → PML_DEPENDS_SELF (US-2 AC2)', () => {
    project.write(
      '.ycsf/apps.yaml',
      `version: 1
apps:
  a: { source_path: a, builder: nestjs-function, depends_on: [a] }
`,
    );
    const diagnostics = flatDiagnostics(project);
    expect(codesOf(diagnostics)).toContain(PML_DEPENDS_SELF);
  });

  it('Sc4: dangling reference → PML_DEPENDS_UNKNOWN naming nonexistent (US-2 AC3)', () => {
    project.write(
      '.ycsf/apps.yaml',
      `version: 1
apps:
  a: { source_path: a, builder: nestjs-function, depends_on: [nonexistent] }
`,
    );
    const diagnostics = flatDiagnostics(project);
    const dangling = diagnostics.find((diagnostic) => diagnostic.code === PML_DEPENDS_UNKNOWN);
    expect(dangling).toBeDefined();
    expect(dangling?.message).toContain('nonexistent');
  });

  it('Sc5: app_id == functions resource_id → PML_IDENTITY_COLLISION with identity set (US-3 AC1)', () => {
    project.write(
      '.ycsf/apps.yaml',
      `version: 1
apps:
  legacy_authorizer: { source_path: legacy_authorizer, builder: nestjs-function }
`,
    );
    project.write(
      '.ycsf/resources.yaml',
      `version: 1
functions:
  legacy_authorizer: {}
`,
    );
    const diagnostics = flatDiagnostics(project);
    const collision = diagnostics.find((diagnostic) => diagnostic.code === PML_IDENTITY_COLLISION);
    expect(collision).toBeDefined();
    expect(collision?.identity).toBe('functions.legacy_authorizer');
    expect(collision?.message).toContain("functions.legacy_authorizer' exists in both apps.yaml and resources.yaml");
  });

  it('Sc6: duplicate app_id key → PML_DUPLICATE_KEY, never silent last-wins (US-3 AC2)', () => {
    project.write(
      '.ycsf/apps.yaml',
      `version: 1
apps:
  user_service: { source_path: user_service, builder: nestjs-function }
  user_service: { source_path: user_service2, builder: docker }
`,
    );
    const diagnostics = flatDiagnostics(project);
    expect(codesOf(diagnostics)).toContain(PML_DUPLICATE_KEY);
  });

  it('Sc7: missing ENV → PML_ENV_NOT_SET for BOTH names (collect-all) (US-4 AC1)', () => {
    vi.stubEnv('ANALYTICS_DOCKERFILE', '');
    vi.stubEnv('NPM_TOKEN', '');
    project.write('.ycsf/apps.yaml', 'version: 1\napps:\n  analytics: { source_path: analytics, builder: docker }\n');
    project.write(
      'analytics/build_config.yaml',
      `version: 1
build_config:
  dockerfile: "{{$ANALYTICS_DOCKERFILE}}"
build_env:
  NPM_TOKEN:
`,
    );
    const diagnostics = flatDiagnostics(project);
    const unset = diagnostics.filter((diagnostic) => diagnostic.code === PML_ENV_NOT_SET);
    expect(unset).toHaveLength(2);
    // both names present, each carrying app: analytics + its source field
    expect(unset.some((d) => d.message.includes('ANALYTICS_DOCKERFILE'))).toBe(true);
    expect(unset.some((d) => d.message.includes('NPM_TOKEN'))).toBe(true);
    expect(unset.every((d) => d.app === 'analytics')).toBe(true);
  });

  it('Sc8: ENV present → { kind: "ok" }, env_requirements record both with isSet true (US-4 AC2)', () => {
    vi.stubEnv('ANALYTICS_DOCKERFILE', 'Dockerfile');
    vi.stubEnv('NPM_TOKEN', 's3cr3t');
    project.write('.ycsf/apps.yaml', 'version: 1\napps:\n  analytics: { source_path: analytics, builder: docker }\n');
    project.write(
      'analytics/build_config.yaml',
      `version: 1
build_config:
  dockerfile: "{{$ANALYTICS_DOCKERFILE}}"
build_env:
  NPM_TOKEN:
`,
    );
    const result = loadProjectModel(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.model.env_requirements.get('ANALYTICS_DOCKERFILE')?.isSet).toBe(true);
    expect(result.model.env_requirements.get('NPM_TOKEN')?.isSet).toBe(true);
    expect(result.model.build_configs.get('analytics')?.build_env).toEqual({ NPM_TOKEN: null });
  });

  it('Sc9: app without build_config.yaml → ok, empty BuildConfig (US-5 AC1)', () => {
    project.write('.ycsf/apps.yaml', 'version: 1\napps:\n  simple_app: { source_path: simple_app, builder: nestjs-function }\n');
    const result = loadProjectModel(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.model.build_configs.get('simple_app')).toEqual({
      build_config: {},
      build_env: {},
    });
  });

  it('Sc10: missing version OR version: 2 → PML_VERSION (US-6 AC1/AC2)', () => {
    project.write(
      '.ycsf/apps.yaml',
      'apps:\n  a: { source_path: a, builder: nestjs-function }\n',
    );
    expect(codesOf(flatDiagnostics(project))).toContain(PML_VERSION);

    project.write(
      '.ycsf/apps.yaml',
      'version: 2\napps:\n  a: { source_path: a, builder: nestjs-function }\n',
    );
    expect(codesOf(flatDiagnostics(project))).toContain(PML_VERSION);
  });

  it('edge: empty apps.yaml → ok with 0 apps; empty resources.yaml → ok; no depends_on → ok (plan Q3/Q4, spec edge cases)', () => {
    project.write('.ycsf/apps.yaml', 'version: 1\napps: {}\n');
    project.write('.ycsf/resources.yaml', 'version: 1\n');
    const result = loadProjectModel(project.root);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.model.apps).toHaveLength(0);
    expect(result.model.resources).toHaveLength(0);
    expect(result.model.depends_on_graph.topologicalOrder).toEqual([]);
  });

  it('edge: unknown builder value and nonexistent source_path are NOT load errors (spec 013/020 deferred)', () => {
    project.write(
      '.ycsf/apps.yaml',
      'version: 1\napps:\n  a: { source_path: does-not-exist, builder: some-future-builder }\n',
    );
    const result = loadProjectModel(project.root);
    expect(result.kind).toBe('ok');
  });

  it('exit: missing .ycsf/apps.yaml throws an I/O error (never a validation result)', () => {
    project.write('.ycsf/resources.yaml', 'version: 1\n');
    expect(() => loadProjectModel(project.root)).toThrow(/missing .ycsf\/apps\.yaml/);
  });

  it('SC-001: 5-app / 3-resource / 10-ENV project loads well under 500ms (perf headroom)', () => {
    const apps: Record<string, unknown> = {};
    for (let i = 0; i < 5; i++) {
      apps[`app_${i}`] = { source_path: `app_${i}`, builder: 'docker' };
    }
    const envBody: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      vi.stubEnv(`APP_ENV_${i}`, `value-${i}`);
      envBody[`APP_ENV_${i}`] = '{{$APP_ENV_' + i + '}}';
    }
    project.write('.ycsf/apps.yaml', `version: 1\napps:\n${Object.keys(apps).map((appId) => `  ${appId}: { source_path: ${appId}, builder: docker }\n`).join('')}`);
    project.write(
      '.ycsf/resources.yaml',
      `version: 1
queues:
  q1: {}
  q2: {}
buckets:
  b1: {}
`,
    );
    const buildConfig = `version: 1\nbuild_config:\n${Object.entries(envBody).map(([name, value]) => `  ${name}: "${value}"\n`).join('')}`;
    project.write('app_0/build_config.yaml', buildConfig);

    const start = Date.now();
    const result = loadProjectModel(project.root);
    const elapsed = Date.now() - start;
    expect(result.kind).toBe('ok');
    expect(elapsed).toBeLessThan(500);
  });
});