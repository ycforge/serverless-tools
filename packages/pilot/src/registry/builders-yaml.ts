import { parseDocument } from 'yaml';

import {
  BRG_DUPLICATE_KEY,
  BRG_INVALID,
  BRG_KEY_COLLISION,
  BRG_VERSION,
} from '../contracts/index.js';
import { diag } from './errors.js';

export type ParseBuildersYamlResult =
  | { kind: 'ok'; data: { version: number; builders: Record<string, string>; materializers: Record<string, string> } }
  | { kind: 'invalid'; errors: readonly import('../contracts/index.js').ProjectModelDiagnostic[] };

const KEY_RE = /^[\w-]+$/;

export function parseBuildersYaml(text: string, file: string): ParseBuildersYamlResult {
  const doc = parseDocument(text, { uniqueKeys: true });

  // YAML syntax errors (including duplicate keys via uniqueKeys: true)
  if (doc.errors.length > 0) {
    const errors = doc.errors.map((error) => {
      const code = error.code === 'DUPLICATE_KEY' ? BRG_DUPLICATE_KEY : BRG_INVALID;
      const line = error.linePos?.[0]?.line;
      const column = error.linePos?.[0]?.col;
      return diag({
        code,
        message: error.message,
        file,
        ...(line !== undefined ? { line: line + 1 } : {}),
        ...(column !== undefined ? { column } : {}),
      });
    });
    return { kind: 'invalid', errors };
  }

  const data = doc.toJS() as Record<string, unknown> | null;

  // version check
  const version = data?.version;
  if (version !== 1) {
    return {
      kind: 'invalid',
      errors: [
        diag({
          code: BRG_VERSION,
          message:
            version === undefined
              ? `missing version in ${file} (supported: 1)`
              : `unsupported version '${String(version)}' in ${file} (supported: 1)`,
          file,
        }),
      ],
    };
  }

  // Extract builders and materializers
  const rawBuilders = (data?.builders ?? {}) as Record<string, unknown>;
  const rawMaterializers = (data?.materializers ?? {}) as Record<string, unknown>;

  // Validate both are objects (not arrays, etc.)
  if (typeof rawBuilders !== 'object' || Array.isArray(rawBuilders)) {
    return {
      kind: 'invalid',
      errors: [
        diag({ code: BRG_INVALID, message: `'builders' in ${file} must be a mapping`, file }),
      ],
    };
  }
  if (typeof rawMaterializers !== 'object' || Array.isArray(rawMaterializers)) {
    return {
      kind: 'invalid',
      errors: [
        diag({ code: BRG_INVALID, message: `'materializers' in ${file} must be a mapping`, file }),
      ],
    };
  }

  const errors: import('../contracts/index.js').ProjectModelDiagnostic[] = [];
  const builders: Record<string, string> = {};
  const materializers: Record<string, string> = {};

  // Validate builder keys and values
  for (const [key, value] of Object.entries(rawBuilders)) {
    if (!KEY_RE.test(key)) {
      errors.push(diag({ code: BRG_INVALID, message: `invalid key '${key}' in builders (must match [\\w-]+)`, file }));
      continue;
    }
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(diag({ code: BRG_INVALID, message: `invalid value for key '${key}' in builders (must be a non-empty string)`, file }));
      continue;
    }
    builders[key] = value;
  }

  // Validate materializer keys and values
  for (const [key, value] of Object.entries(rawMaterializers)) {
    if (!KEY_RE.test(key)) {
      errors.push(diag({ code: BRG_INVALID, message: `invalid key '${key}' in materializers (must match [\\w-]+)`, file }));
      continue;
    }
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(diag({ code: BRG_INVALID, message: `invalid value for key '${key}' in materializers (must be a non-empty string)`, file }));
      continue;
    }
    materializers[key] = value;
  }

  // Cross-section key collision
  for (const key of Object.keys(builders)) {
    if (key in materializers) {
      errors.push(
        diag({ code: BRG_KEY_COLLISION, message: `duplicate key '${key}' in builders and materializers`, file }),
      );
    }
  }

  if (errors.length > 0) {
    return { kind: 'invalid', errors };
  }

  return { kind: 'ok', data: { version: 1, builders, materializers } };
}
