import { afterEach, describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { createBuildableProject, removeTempProject, type TempProject } from '../helpers/buildable-project.js';
import { createTempProject } from '../../helpers/temp-project.js';

const exec = promisify(execFile);
const CLI = resolve(import.meta.dirname, '../../../dist/cli/index.js');
const CANONICAL = resolve(import.meta.dirname, '../../check/fixtures/canonical');
const BUILDER_FUNCTION = resolve(import.meta.dirname, '../../materialize/fixtures/builder-function.mjs');
const CORES_FUNCTION = resolve(import.meta.dirname, '../../../../materializers-core/dist/yandex-function/index.js');

function runCli(cwd: string, args: string[]) {
  return exec('node', [CLI, ...args], {
    cwd,
    env: process.env as Record<string, string>,
    timeout: 15000,
  })
    .then((r: { stdout: string; stderr: string }) => ({ stdout: r.stdout, stderr: r.stderr, code: 0 }))
    .catch((err: { stdout: string; stderr: string; code?: number }) => ({
    stdout: err.stdout,
    stderr: err.stderr,
    code: err.code ?? 1,
  }));
}

describe('materialize integration (T061)', () => {
  let project: TempProject | undefined;

  afterEach(() => {
    if (project) removeTempProject(project);
    project = undefined;
  });

  it('materialize a project with a working registry → generates .tf.json files', async () => {
    project = createBuildableProject();
    const result = await runCli(project.root, ['materialize', '--project-dir', project.root]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Generated:');
    expect(existsSync(join(project.root, 'infra/user_service.ycsf.tf.json'))).toBe(true);
    expect(existsSync(join(project.root, 'infra/analytics.ycsf.tf.json'))).toBe(true);
  });

  it('--target unknown_app → exit 2, CLI_APP_NOT_FOUND', async () => {
    const result = await runCli(CANONICAL, ['materialize', '--project-dir', CANONICAL, '--target', 'unknown_app']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('CLI_APP_NOT_FOUND');
  });

  it('--target user_service → only infra/user_service.ycsf.tf.json exists', async () => {
    project = createBuildableProject();
    const result = await runCli(project.root, ['materialize', '--project-dir', project.root, '--target', 'user_service']);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('Generated:');
    expect(existsSync(join(project.root, 'infra/user_service.ycsf.tf.json'))).toBe(true);
    expect(existsSync(join(project.root, 'infra/analytics.ycsf.tf.json'))).toBe(false);
  });
});

describe('standalone materialize without a build store (spec 028, T017)', () => {
  let project: TempProject | undefined;

  afterEach(() => {
    if (project) removeTempProject(project);
    project = undefined;
  });

  function createRealCoreProject(): TempProject {
    const p = createTempProject({
      '.ycsf/apps.yaml': `version: 1
apps:
  user_service: { source_path: user_service, builder: ycforge:function }
`,
      'user_service/index.js': 'export const handler = () => "user_service";',
      'dist/user_service.zip': 'spec-028-function-archive-bytes',
      'infra/main.tf': '# managed by ycsf\n',
    });
    p.write(
      '.ycsf/builders.yaml',
      `version: 1
builders:
  "ycforge:function": "${BUILDER_FUNCTION}"
materializers:
  yandex-function: "${CORES_FUNCTION}"
`,
    );
    return p;
  }

  it('real core materializer without a build → fail-fast MTL_MATERIALIZE_FAILED with actionable text', async () => {
    project = createRealCoreProject();
    const result = await runCli(project.root, ['materialize', '--project-dir', project.root]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('MTL_MATERIALIZE_FAILED');
    expect(result.stderr).toContain('ycsf build');
    expect(result.stderr).not.toContain('Cannot destructure');
  });

  it('--artifacts <dir> with a populated store → materialize succeeds (T018)', async () => {
    project = createRealCoreProject();
    const build = await runCli(project.root, ['build', '--project-dir', project.root]);
    expect(build.code).toBe(0);
    expect(existsSync(join(project.root, '.ycsf', 'artifacts', 'user_service', 'artifact.json'))).toBe(true);

    const result = await runCli(project.root, ['materialize', '--project-dir', project.root, '--artifacts', join(project.root, '.ycsf', 'artifacts')]);
    expect(result.code).toBe(0);
    expect(existsSync(join(project.root, 'infra/user_service.ycsf.tf.json'))).toBe(true);
  });
});