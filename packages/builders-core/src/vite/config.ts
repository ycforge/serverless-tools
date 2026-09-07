/**
 * App-level build_config parsing for builder `vite` (spec 011,
 * contracts/builders-core.json #/definitions/viteBuildConfig).
 * Defaults: `out_dir` = "dist", `root` = ".", `command` = "vite build".
 * Known-field violations throw `BLC_INVALID_CONFIG`.
 */

import { requireString } from '../config.js';
import { BLC_INVALID_CONFIG, builderError } from '../diagnostics.js';

export interface ParsedViteConfig {
  readonly out_dir: string;
  readonly root: string;
  readonly command: string;
}

function invalid(field: string): never {
  throw builderError(
    BLC_INVALID_CONFIG,
    `build_config: ${field} has invalid value (${BLC_INVALID_CONFIG})`,
    { field },
  );
}

export function parseViteConfig(raw: unknown): ParsedViteConfig {
  const record = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  const out_dir = record.out_dir === undefined ? 'dist' : record.out_dir;
  if (!requireString(out_dir)) invalid('out_dir');

  const root = record.root === undefined ? '.' : record.root;
  if (!requireString(root)) invalid('root');

  const command = record.command === undefined ? 'vite build' : record.command;
  if (!requireString(command)) invalid('command');

  return { out_dir, root, command };
}