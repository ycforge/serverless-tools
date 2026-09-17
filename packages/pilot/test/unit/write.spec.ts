import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeGeneratedTerraform } from '../../src/materialize/write.js';
import { createTempProject, removeTempProject, type TempProject } from '../helpers/temp-project.js';

// T023–T025: write.spec.ts — I/O-only writeGeneratedTerraform (Sc5/14/15, FR-015/016).

let project: TempProject | undefined;

function newProject(infraFiles: Record<string, string> = {}): TempProject {
  project = createTempProject({
    'infra/user_service.ycsf.tf.json': '{"stale":true}',
    'infra/main.tf': '# user\nresource "yandex_vpc_network" "net" {}\n',
    ...infraFiles,
  });
  return project;
}

const infra = (p: TempProject): string => join(p.root, 'infra');

afterEach(() => {
  if (project) removeTempProject(project);
  project = undefined;
});

describe('write.ts', () => {
  it('T023: writes generated files into infra/, creating the dir recursively (Sc15, FR-015)', async () => {
    const p = createTempProject({}); // no infra/ dir yet
    try {
      await writeGeneratedTerraform(join(p.root, 'infra'), [
        { filename: 'app.ycsf.tf.json', content: '{}' },
      ]);
      expect(existsSync(join(p.root, 'infra/app.ycsf.tf.json'))).toBe(true);
      expect(readFileSync(join(p.root, 'infra/app.ycsf.tf.json'), 'utf8')).toBe('{}');
    } finally {
      removeTempProject(p);
    }
  });

  it('T024: removes stale C-owned *.ycsf.tf.json and leaves user *.tf untouched (Sc5, FR-016)', async () => {
    const p = newProject();
    await writeGeneratedTerraform(infra(p), [
      { filename: 'analytics.ycsf.tf.json', content: '{"resource":{}}' },
    ]);
    expect(existsSync(join(p.root, 'infra/analytics.ycsf.tf.json'))).toBe(true);
    expect(existsSync(join(p.root, 'infra/user_service.ycsf.tf.json'))).toBe(false);
    expect(readFileSync(join(p.root, 'infra/main.tf'), 'utf8')).toBe('# user\nresource "yandex_vpc_network" "net" {}\n');
  });

  it('T025: path traversal or absolute filename → rejects before any write (A3)', async () => {
    for (const filename of ['../evil.ycsf.tf.json', 'sub/evil.ycsf.tf.json', '/abs/evil.ycsf.tf.json']) {
      await expect(
        writeGeneratedTerraform(infra(newProject()), [{ filename, content: '{}' }]),
      ).rejects.toThrow(/filename/i);
    }
    const p = project;
    expect(p).toBeDefined();
    if (p) {
      expect(readdirSync(infra(p)).sort()).toEqual(['main.tf', 'user_service.ycsf.tf.json']);
    }
  });

  it('T025b: write never touches *.tf files even under the ownership glob edge', async () => {
    const p = newProject({ 'infra/main.tf': '# user' });
    await writeGeneratedTerraform(infra(p), [{ filename: 'x.ycsf.tf.json', content: '{}' }]);
    expect(readFileSync(join(p.root, 'infra/main.tf'), 'utf8')).toBe('# user');
  });
});