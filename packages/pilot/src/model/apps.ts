import {
  PML_INVALID,
  type App,
  type ProjectModelDiagnostic,
} from '../contracts/index.js';

import { diag } from './errors.js';
import { isRecord, isStringArray } from './types.js';

/**
 * apps.yaml → App records (US-1, FR-001). Shape checks (FR-012): only
 * source_path/builder/depends_on per app; no builder-specific keys. Layout
 * level only — an unknown `builder` value is not a load error (spec 013).
 */
export type AppsResult =
  | { kind: 'ok'; apps: App[] }
  | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] };

const APP_ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const ALLOWED_KEYS = new Set(['source_path', 'builder', 'depends_on']);

export function extractApps(data: unknown, file: string): AppsResult {
  if (!isRecord(data)) {
    return invalidApps(file, diag({ code: PML_INVALID, message: `${file} must be a mapping`, file }));
  }
  const errors: ProjectModelDiagnostic[] = [];
  const apps: App[] = [];

  const rawApps = data.apps;
  if (rawApps === undefined) {
    return { kind: 'ok', apps: [] };
  }
  if (!isRecord(rawApps)) {
    return invalidApps(
      file,
      diag({ code: PML_INVALID, message: `${file}: 'apps' must be a mapping`, file, field: 'apps' }),
    );
  }

  for (const [appId, rawEntry] of Object.entries(rawApps)) {
    if (!APP_ID_RE.test(appId)) {
      errors.push(
        diag({
          code: PML_INVALID,
          message: `invalid app_id '${appId}' (must match ${APP_ID_RE.source})`,
          file,
          field: appId,
        }),
      );
      continue;
    }
    if (!isRecord(rawEntry)) {
      errors.push(
        diag({
          code: PML_INVALID,
          message: `app '${appId}' must be a mapping`,
          file,
          app: appId,
        }),
      );
      continue;
    }

    for (const key of Object.keys(rawEntry)) {
      if (!ALLOWED_KEYS.has(key)) {
        errors.push(
          diag({
            code: PML_INVALID,
            message: `unknown key '${key}' for app '${appId}' — apps.yaml allows only source_path, builder, depends_on (FR-012)`,
            file,
            app: appId,
            field: key,
          }),
        );
      }
    }

    const sourcePath = rawEntry.source_path;
    if (sourcePath === undefined) {
      errors.push(
        diag({
          code: PML_INVALID,
          message: `missing 'source_path' for app '${appId}'`,
          file,
          app: appId,
          field: 'source_path',
        }),
      );
    } else if (typeof sourcePath !== 'string') {
      errors.push(
        diag({
          code: PML_INVALID,
          message: `'source_path' for app '${appId}' must be a string`,
          file,
          app: appId,
          field: 'source_path',
        }),
      );
    }

    const builder = rawEntry.builder;
    if (builder === undefined) {
      errors.push(
        diag({
          code: PML_INVALID,
          message: `missing 'builder' for app '${appId}'`,
          file,
          app: appId,
          field: 'builder',
        }),
      );
    } else if (typeof builder !== 'string') {
      errors.push(
        diag({
          code: PML_INVALID,
          message: `'builder' for app '${appId}' must be a string`,
          file,
          app: appId,
          field: 'builder',
        }),
      );
    }

    let dependsOn: string[] = [];
    const rawDependsOn = rawEntry.depends_on;
    if (rawDependsOn !== undefined) {
      if (isStringArray(rawDependsOn)) {
        dependsOn = rawDependsOn;
      } else {
        errors.push(
          diag({
            code: PML_INVALID,
            message: `'depends_on' for app '${appId}' must be a list of app_ids`,
            file,
            app: appId,
            field: 'depends_on',
          }),
        );
      }
    }

    if (typeof sourcePath === 'string' && typeof builder === 'string') {
      apps.push({ app_id: appId, source_path: sourcePath, builder, depends_on: dependsOn });
    }
  }

  if (errors.length > 0) {
    return { kind: 'invalid', errors };
  }
  return { kind: 'ok', apps };
}

function invalidApps(file: string, diagnostic: ProjectModelDiagnostic): AppsResult {
  return { kind: 'invalid', errors: [diagnostic] };
}