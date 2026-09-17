// spec 016 outputs — `.ycsf/outputs.yaml` parse gate (pattern 015
// `parseExtensionsYaml`): YAML syntax, duplicate keys (uniqueKeys: true),
// `version: 1` and outputs structure. Parse-gate and structural failures all
// map to OUT_INVALID (no dedicated OUT_DUPLICATE_KEY code); the version gate
// short-circuits with a single OUT_VERSION error.
//
// IDL-grammar of `value` is NOT checked here — that is buildOutputs'
// responsibility (loader ≠ apply, pattern 015).
import { parseDocument, type Document } from 'yaml';

import { OUT_INVALID, OUT_VERSION } from '../contracts/index.js';
import type { OutputsDiagnostic, OutputValue, OutputsYaml } from '../contracts/index.js';
import { isPlainObject } from '../extensions/deep-merge.js';
import { out } from './errors.js';

const TOP_LEVEL_KEYS = new Set(['version', 'outputs']);
const ENTRY_KEYS = new Set(['value', 'description']);
const NAME_RE = /^[a-z][a-z0-9_]*$/;

export type ParseOutputsYamlResult =
  | { kind: 'ok'; data: OutputsYaml }
  | { kind: 'invalid'; errors: readonly OutputsDiagnostic[] };

function structuralErr(file: string, message: string): OutputsDiagnostic {
  return out({ code: OUT_INVALID, message, file });
}

export function parseOutputsYaml(text: string, file: string): ParseOutputsYamlResult {
  const doc: Document = parseDocument(text, { uniqueKeys: true });

  // Parse gate: YAML syntax errors, including duplicate keys via uniqueKeys.
  if (doc.errors.length > 0) {
    const errors = doc.errors.map((error) => {
      const line = error.linePos?.[0]?.line;
      const column = error.linePos?.[0]?.col;
      return out({
        code: OUT_INVALID,
        message: error.message,
        file,
        ...(line !== undefined ? { line: line + 1 } : {}),
        ...(column !== undefined ? { column } : {}),
      });
    });
    return { kind: 'invalid', errors };
  }

  const data = doc.toJS() as unknown;

  // Version gate — short-circuit with a single OUT_VERSION error.
  const raw = (isPlainObject(data) ? data : {}) as { version?: unknown };
  if (raw.version !== 1) {
    return {
      kind: 'invalid',
      errors: [
        out({
          code: OUT_VERSION,
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

  // Structural validation — collect-ALL errors (FR-004, Constitution V).
  const errors: OutputsDiagnostic[] = [];
  for (const key of Object.keys(data)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      errors.push(structuralErr(file, `unknown top-level key '${key}' in ${file}`));
    }
  }

  const rawOutputs = data.outputs;
  if (rawOutputs === undefined || rawOutputs === null) {
    errors.push(structuralErr(file, `missing 'outputs' in ${file}`));
  } else if (!isPlainObject(rawOutputs)) {
    errors.push(structuralErr(file, `'outputs' in ${file} must be a mapping`));
  } else {
    for (const [name, rawEntry] of Object.entries(rawOutputs)) {
      if (!NAME_RE.test(name)) {
        errors.push(
          structuralErr(file, `invalid output name '${name}' in ${file} (must match [a-z][a-z0-9_]*)`),
        );
        continue;
      }
      if (!isPlainObject(rawEntry)) {
        errors.push(structuralErr(file, `output '${name}' in ${file} must be a mapping { value: string }`));
        continue;
      }
      for (const key of Object.keys(rawEntry)) {
        if (!ENTRY_KEYS.has(key)) {
          errors.push(
            structuralErr(file, `unknown key '${key}' in output '${name}' in ${file} (expected 'value', 'description')`),
          );
        }
      }
      const value = rawEntry.value;
      if (typeof value !== 'string') {
        errors.push(structuralErr(file, `output '${name}' in ${file} must have a string 'value'`));
      }
      const description = rawEntry.description;
      if (description !== undefined && typeof description !== 'string') {
        errors.push(structuralErr(file, `'description' of output '${name}' in ${file} must be a string`));
      }
    }
  }

  if (errors.length > 0) return { kind: 'invalid', errors };

  const outputs: Record<string, OutputValue> = {};
  const entries = (data.outputs as Record<string, Record<string, unknown>>);
  for (const [name, rawEntry] of Object.entries(entries)) {
    outputs[name] = {
      value: rawEntry.value as string,
      ...(rawEntry.description !== undefined ? { description: rawEntry.description as string } : {}),
    };
  }

  return { kind: 'ok', data: { version: 1, outputs } };
}