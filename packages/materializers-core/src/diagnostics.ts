/**
 * YMT_* materializer diagnostics (contract `specs/019-materializers-yandex/
 * contracts/materializers-core.json` #/errorCodes). Constants, compared always
 * via the identifiers — never as string literals (Constitution V). Codes are
 * additive and non-breaking.
 */

export interface MaterializerError extends Error {
  code: string;
  materializer?: string;
}

export const YMT_INVALID_QUEUE_URL = 'YMT_INVALID_QUEUE_URL';
export const YMT_INVALID_ARTIFACT_VALUE = 'YMT_INVALID_ARTIFACT_VALUE';
export const YMT_EMPTY_DIRECTORY = 'YMT_EMPTY_DIRECTORY';

export interface MaterializerErrorOptions {
  readonly materializer?: string;
}

export function materializerError(code: string, message: string, options?: MaterializerErrorOptions): MaterializerError {
  const err = new Error(message) as MaterializerError;
  err.name = 'MaterializerError';
  err.code = code;
  if (options?.materializer !== undefined) err.materializer = options.materializer;
  return err;
}