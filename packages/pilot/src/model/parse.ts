import { parseDocument, type Document } from 'yaml';

import {
  PML_DUPLICATE_KEY,
  PML_PARSE,
  PML_VERSION,
  isVersion,
  type ProjectModelDiagnostic,
} from '../contracts/index.js';
import { diag } from './errors.js';

/**
 * Low-level `.ycsf/*.yaml` parse gate: YAML syntax + duplicate keys
 * (parseDocument with uniqueKeys:true, research decision 6) and the
 * `version: 1` requirement (FR-004/FR-014, Constitution III). Runs before any
 * extractor sees a file; extractors receive `data` — the plain JS document.
 */
export type ParseResult =
  | { kind: 'ok'; doc: Document.Parsed; data: unknown }
  | { kind: 'invalid'; errors: readonly ProjectModelDiagnostic[] };

export function parseYaml(text: string, file: string): ParseResult {
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length > 0) {
    const errors = doc.errors.map((error) => {
      const code = error.code === 'DUPLICATE_KEY' ? PML_DUPLICATE_KEY : PML_PARSE;
      const line = error.linePos?.[0]?.line;
      const column = error.linePos?.[0]?.col;
      return diag({
        code,
        message: error.message,
        file,
        ...(line !== undefined ? { line } : {}),
        ...(column !== undefined ? { column } : {}),
      });
    });
    return { kind: 'invalid', errors };
  }

  const data = doc.toJS();
  if (!isVersion((data as Record<string, unknown> | null)?.version)) {
    const version = (data as Record<string, unknown> | null | undefined)?.version;
    return {
      kind: 'invalid',
      errors: [
        diag({
          code: PML_VERSION,
          message:
            version === undefined
              ? `missing version field in ${file} (supported: 1)`
              : `unsupported version '${String(version)}' in ${file} (supported: 1)`,
          file,
          field: 'version',
        }),
      ],
    };
  }

  return { kind: 'ok', doc, data };
}