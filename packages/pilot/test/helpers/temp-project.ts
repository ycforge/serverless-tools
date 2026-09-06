import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Deterministic in-test temp project for the spec 011 integration/unit files.
 * A project is a root dir populated with `.ycsf/*.yaml` + `<app>/build_config.yaml`
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