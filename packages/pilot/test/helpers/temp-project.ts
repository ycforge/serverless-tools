import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Deterministic in-test temp project for the spec 011 integration/unit files.
 * A project is a root dir populated with `.ycsf/*.yaml` + `<source_path>/build_config.yaml`
 * files; the root is removed by the caller (see `removeTempProject`).
 */
export interface TempProject {
  readonly root: string;
  write(relPath: string, text: string): void;
}

export function createTempProject(files: Record<string, string> = {}): TempProject {
  const root = mkdtempSync(join(tmpdir(), 'pilot-project-model-'));
  const write = (relPath: string, text: string): void => {
    const full = join(root, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text, 'utf8');
  };
  for (const [relPath, text] of Object.entries(files)) {
    write(relPath, text);
  }
  return { root, write };
}

export function removeTempProject(project: TempProject): void {
  rmSync(project.root, { recursive: true, force: true });
}

/**
 * spec 028 consumer-graph fixture (T032/T033): lay `package.json` + a
 * `node_modules/<spec/>` SYMLINK into the temp project so that bare-specifier
 * resolution (createRequire(<root>/package.json).resolve) can reach the
 * package — hermetic, no network. `spec` is e.g. `@ycforge/builders-core`.
 */
export function linkConsumerNodeModule(project: TempProject, spec: string, targetDir: string): void {
  project.write(
    'package.json',
    `${JSON.stringify({ name: 'consumer-fixture', version: '1.0.0', private: true, dependencies: { [spec]: 'workspace:*' } }, null, 2)}\n`,
  );
  const scopedDir = join(project.root, 'node_modules', ...spec.split('/'));
  mkdirSync(dirname(scopedDir), { recursive: true });
  writeFileSync(scopedDir, ''); // placeholder to create the leaf dir, replaced below
  rmSync(scopedDir, { recursive: true, force: true });
  mkdirSync(dirname(scopedDir), { recursive: true });
  symlinkSync(targetDir, scopedDir, 'dir');
}

/**
 * spec 028 consumer-graph fixture (T032/T033): resolve the on-disk ROOT of a
 * workspace package (e.g. `@ycforge/builders-core`) from this test's own
 * module graph. `./package.json` is usually NOT an exported subpath, so we
 * resolve the package's main entry and walk up to its `package.json`.
 */
export function resolveWorkspacePackageRoot(spec: string): string {
  const resolved = createRequire(import.meta.url).resolve(spec);
  let dir = dirname(resolved);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`unable to locate package root for '${spec}' (resolved: ${resolved})`);
}