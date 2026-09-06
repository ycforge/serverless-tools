// spec 015 extensions — `.ycsf/extensions.yaml` parse gate: YAML syntax,
// duplicate keys (uniqueKeys: true), `version: 1` and rule-form structure.
// Parse-gate and structural failures all map to EXT_INVALID (no dedicated
// EXT_DUPLICATE_KEY code); the version gate short-circuits with a single
// EXT_VERSION error.
import { parseDocument, type Document } from 'yaml';

import { EXT_INVALID, EXT_VERSION } from '../contracts/index.js';
import type { ExtensionRule, ExtensionsYaml, ProjectModelDiagnostic } from '../contracts/index.js';
import { isPlainObject } from './deep-merge.js';
import { IDL_SEGMENT_RE } from './idl.js';
import { diag } from '../model/errors.js';

const TOP_LEVEL_KEYS = new Set(['version', 'extensions']);

export type ParseExtensionsYamlResult =
  | { kind: 'ok'; data: ExtensionsYaml }
  | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] };

function structuralErr(file: string, message: string): ProjectModelDiagnostic {
  return diag({ code: EXT_INVALID, message, file });
}

/**
 * Validate a single rule-shaped mapping (list entry, or a mapping that took
 * the place of the `extensions` list — §25.3 mapping-as-rule). Unknown keys
 * abort fail-fast (Constitution V), other violations are per-rule errors.
 */
function extractRule(raw: unknown, file: string): { rule?: ExtensionRule; error?: ProjectModelDiagnostic } {
  if (!isPlainObject(raw)) {
    return { error: structuralErr(file, `each entry of 'extensions' in ${file} must be a mapping`) };
  }

  for (const key of Object.keys(raw)) {
    if (key !== 'target' && key !== 'patch') {
      return {
        error: structuralErr(
          file,
          `unknown key '${key}' in extension rule in ${file} (expected 'target', 'patch')`,
        ),
      };
    }
  }

  const target = raw.target;
  if (typeof target !== 'string') {
    return { error: structuralErr(file, `extension rule in ${file} must have a string 'target'`) };
  }
  if (!IDL_SEGMENT_RE.test(target)) {
    return {
      error: structuralErr(
        file,
        `invalid target '${target}' in ${file} (must match <domain>.<name>: [a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*)`,
      ),
    };
  }

  const patch = raw.patch;
  if (patch === undefined) {
    return {
      error: structuralErr(file, `extension rule for '${target}' in ${file} must have a 'patch' mapping`),
    };
  }
  if (!isPlainObject(patch)) {
    return { error: structuralErr(file, `'patch' of rule '${target}' in ${file} must be a mapping`) };
  }

  return { rule: { target, patch } };
}

export function parseExtensionsYaml(text: string, file: string): ParseExtensionsYamlResult {
  const doc: Document = parseDocument(text, { uniqueKeys: true });

  // Parse gate: YAML syntax errors, including duplicate keys via uniqueKeys.
  if (doc.errors.length > 0) {
    const errors = doc.errors.map((error) => {
      const line = error.linePos?.[0]?.line;
      const column = error.linePos?.[0]?.col;
      return diag({
        code: EXT_INVALID,
        message: error.message,
        file,
        ...(line !== undefined ? { line: line + 1 } : {}),
        ...(column !== undefined ? { column } : {}),
      });
    });
    return { kind: 'invalid', errors };
  }

  const data = doc.toJS() as unknown;

  // Version gate — short-circuit with a single EXT_VERSION error.
  const raw = (isPlainObject(data) ? data : {}) as { version?: unknown };
  if (raw.version !== 1) {
    return {
      kind: 'invalid',
      errors: [
        diag({
          code: EXT_VERSION,
          message:
            raw.version === undefined
              ? `missing version in ${file} (supported: 1)`
              : `unsupported version '${String(raw.version)}' in ${file} (supported: 1)`,
          file,
        }),
      ],
    };
  }

  if (!isPlainObject(data)) {
    return { kind: 'invalid', errors: [structuralErr(file, `top level of ${file} must be a mapping`)] };
  }

  // Unknown top-level keys → fail-fast.
  for (const key of Object.keys(data)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      return { kind: 'invalid', errors: [structuralErr(file, `unknown top-level key '${key}' in ${file}`)] };
    }
  }

  const rawExtensions = data.extensions;
  if (rawExtensions === undefined || rawExtensions === null) {
    return { kind: 'invalid', errors: [structuralErr(file, `missing 'extensions' in ${file}`)] };
  }

  if (!Array.isArray(rawExtensions)) {
    const errors = [structuralErr(file, `'extensions' in ${file} must be a list (sequence of rules)`)];
    if (isPlainObject(rawExtensions)) {
      const asRule = extractRule(rawExtensions, file);
      if (asRule.error !== undefined) errors.push(asRule.error);
    }
    return { kind: 'invalid', errors };
  }

  const errors: ProjectModelDiagnostic[] = [];
  const rules: ExtensionRule[] = [];
  for (const raw of rawExtensions) {
    const out = extractRule(raw, file);
    if (out.error !== undefined) {
      errors.push(out.error);
      continue;
    }
    rules.push(out.rule!);
  }

  if (errors.length > 0) return { kind: 'invalid', errors };

  return { kind: 'ok', data: { version: 1, extensions: rules } };
}