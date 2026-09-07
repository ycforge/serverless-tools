/**
 * App-level build_config parsing for builder `nestjs-function` (spec 011,
 * contracts/builders-core.json #/definitions/nestjsFunctionBuildConfig).
 * Unknown top-level keys are ignored; known-field violations throw
 * `BLC_INVALID_CONFIG` (FR-004).
 */

import { requireString, requireStringArray } from '../config.js';
import { BLC_INVALID_CONFIG, builderError } from '../diagnostics.js';

export interface ParsedNestjsConfig {
  readonly entry: string;
  readonly runtime: 'nodejs20' | 'nodejs22';
  readonly external: readonly string[];
  readonly out_filename: string;
}

function invalid(field: string): never {
  throw builderError(
    BLC_INVALID_CONFIG,
    `build_config: ${field} has invalid value (${BLC_INVALID_CONFIG})`,
    { field },
  );
}

export function parseNestjsConfig(raw: unknown): ParsedNestjsConfig {
  const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  const entry = record.entry === undefined ? 'src/main.ts' : record.entry;
  if (!requireString(entry)) invalid('entry');

  const runtime = record.runtime === undefined ? 'nodejs20' : record.runtime;
  if (runtime !== 'nodejs20' && runtime !== 'nodejs22') invalid('runtime');

  const external = record.external === undefined ? [] : record.external;
  if (!requireStringArray(external)) invalid('external');

  const out_filename = record.out_filename === undefined ? 'function.zip' : record.out_filename;
  if (!requireString(out_filename) || /[\\/]/.test(out_filename)) invalid('out_filename');

  return { entry, runtime: runtime as 'nodejs20' | 'nodejs22', external, out_filename };
}