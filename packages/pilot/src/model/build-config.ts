import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  PML_INVALID,
  type BuildConfig,
  type ProjectModelDiagnostic,
} from '../contracts/index.js';

import { diag } from './errors.js';
import { parseYaml } from './parse.js';
import { isRecord } from './types.js';

/**
 * `<app>/build_config.yaml` → BuildConfig (US-1 AC3, FR-003/FR-011).
 * `build_config` is opaque to C (the builder validates its internals);
 * `build_env` maps ENV_NAME → string | null. Absent file → empty BuildConfig.
 */
export type BuildConfigResult =
  | { kind: 'ok'; build_config: BuildConfig }
  | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] };

/**
 * Reads (if present) + parses + version-gates the app's build_config.yaml.
 * A missing file is valid (FR-003) and yields empty maps.
 */
export function loadAppBuildConfig(rootDir: string, appId: string): BuildConfigResult {
  const file = `${appId}/build_config.yaml`;
  const filePath = join(rootDir, appId, 'build_config.yaml');
  if (!existsSync(filePath)) {
    return { kind: 'ok', build_config: { build_config: {}, build_env: {} } };
  }
  const text = readFileSync(filePath, 'utf8');
  const parsed = parseYaml(text, file);
  if (parsed.kind !== 'ok') {
    return { kind: 'invalid', errors: parsed.errors };
  }
  return extractBuildConfig(parsed.data, file);
}

/**
 * Pure extraction from an already parsed document (`parseYaml` output).
 * `build_config` / `build_env` are optional; both default to `{}`.
 */
export function extractBuildConfig(data: unknown, file: string): BuildConfigResult {
  if (!isRecord(data)) {
    return {
      kind: 'invalid',
      errors: [diag({ code: PML_INVALID, message: `${file} must be a mapping`, file })],
    };
  }

  const errors: ProjectModelDiagnostic[] = [];

  let buildConfig: Record<string, unknown> = {};
  const rawBuildConfig = data.build_config;
  if (rawBuildConfig !== undefined) {
    if (!isRecord(rawBuildConfig)) {
      errors.push(
        diag({
          code: PML_INVALID,
          message: `'build_config' must be a mapping (opaque builder config, FR-011)`,
          file,
          field: 'build_config',
        }),
      );
    } else {
      buildConfig = rawBuildConfig;
    }
  }

  const buildEnv: Record<string, string | null> = {};
  const rawBuildEnv = data.build_env;
  if (rawBuildEnv !== undefined) {
    if (!isRecord(rawBuildEnv)) {
      errors.push(
        diag({
          code: PML_INVALID,
          message: `'build_env' must map ENV_NAME → string | null`,
          file,
          field: 'build_env',
        }),
      );
    } else {
      for (const [name, value] of Object.entries(rawBuildEnv)) {
        if (value === null || typeof value === 'string') {
          buildEnv[name] = value;
        } else {
          errors.push(
            diag({
              code: PML_INVALID,
              message: `build_env['${name}'] must be a string or null`,
              file,
              field: name,
            }),
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    return { kind: 'invalid', errors };
  }
  return { kind: 'ok', build_config: { build_config: buildConfig, build_env: buildEnv } };
}