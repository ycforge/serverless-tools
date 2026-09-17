// spec 035 — relative `-p/--project-dir` values (e.g. `..` from `infra/`) must
// be resolved against the process cwd before use. createRequire() and all
// rootDir-based file lookups anchor to this path; leaving it relative silently
// mis-resolves the builders registry and artifact paths (BRG_MISSING_FILE /
// CLI_BUILD_FAILED "builders registry could not be loaded").
import { isAbsolute, resolve } from 'node:path';

export function resolveProjectRoot(projectDir: string | undefined): string {
  const value = projectDir ?? process.cwd();
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}