import type { Type } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  JDT_ENTRY_MODULE_AMBIGUOUS,
  JDT_ENTRY_MODULE_NOT_FOUND,
  JDT_ENTRY_RESOLVE_FAILED,
  LocalDevServerError,
} from './diagnostics';

/**
 * Loads the root NestJS application module from a user-supplied entry path
 * (FR-005/FR-006, S-3). The path is resolved against `process.cwd()`; named
 * `AppModule` wins, then the default export. Both present but different
 * classes is an explicit ambiguity error rather than a silent pick.
 */
export async function loadEntryModule(entry: string): Promise<Type<unknown>> {
  const target = resolve(process.cwd(), entry);
  if (!existsSync(target)) {
    throw new LocalDevServerError(
      JDT_ENTRY_RESOLVE_FAILED,
      `entry module not found: ${entry}`,
    );
  }

  let imported: Record<string, unknown>;
  try {
    imported = (await import(pathToFileURL(target).href)) as Record<string, unknown>;
  } catch (error) {
    throw new LocalDevServerError(
      JDT_ENTRY_RESOLVE_FAILED,
      importFailureMessage(entry, error),
      error,
    );
  }

  const named = imported.AppModule;
  const defaultExport = imported.default;
  const isFactory = (value: unknown): value is Type<unknown> =>
    typeof value === 'function';

  if (isFactory(named) && isFactory(defaultExport)) {
    if (named !== defaultExport) {
      throw new LocalDevServerError(
        JDT_ENTRY_MODULE_AMBIGUOUS,
        'entry exports both a named AppModule and a different default export',
      );
    }
    return named;
  }
  if (isFactory(named)) {
    return named;
  }
  if (isFactory(defaultExport)) {
    return defaultExport;
  }
  throw new LocalDevServerError(
    JDT_ENTRY_MODULE_NOT_FOUND,
    'entry does not export a NestJS application module (expected a named AppModule or a default export)',
  );
}

function importFailureMessage(entry: string, error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      return (
        `failed to import entry module: ${entry} — ` +
        'TypeScript entries require a host loader such as tsx (node --import tsx)'
      );
    }
  }
  return `failed to import entry module: ${entry}`;
}