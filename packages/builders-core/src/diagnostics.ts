/**
 * BLC_* builder diagnostics (contract `specs/018-builders-core/contracts/builders-core.json`
 * #/errorCodes). Constants, compared always via the identifiers — never as
 * string literals (Constitution V). Codes are additive and non-breaking.
 */

export interface BuilderError extends Error {
  code: string;
  builder?: string;
  field?: string;
}

export const BLC_INVALID_CONFIG = 'BLC_INVALID_CONFIG';
export const BLC_MISSING_SOURCE = 'BLC_MISSING_SOURCE';
export const BLC_ENTRY_NOT_FOUND = 'BLC_ENTRY_NOT_FOUND';
export const BLC_BUILD_FAILED = 'BLC_BUILD_FAILED';
export const BLC_ENV_NOT_RESOLVED = 'BLC_ENV_NOT_RESOLVED';
export const BLC_IMAGE_DIGEST_UNAVAILABLE = 'BLC_IMAGE_DIGEST_UNAVAILABLE';
export const BLC_ARCHIVE_FAILED = 'BLC_ARCHIVE_FAILED';

export interface BuilderErrorOptions {
  readonly builder?: string;
  readonly field?: string;
}

export function builderError(code: string, message: string, options?: BuilderErrorOptions): BuilderError {
  const err = new Error(message) as BuilderError;
  err.name = 'BuilderError';
  err.code = code;
  if (options?.builder !== undefined) err.builder = options.builder;
  if (options?.field !== undefined) err.field = options.field;
  return err;
}