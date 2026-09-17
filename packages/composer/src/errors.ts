export type ExtractErrorCode =
  | 'NO_SOURCE'
  | 'INVALID_ARTIFACT'
  | 'ENTRY_LOAD_FAILED'
  | 'ENTRY_EXECUTION_FAILED'
  | 'ENTRY_RETURNED_INVALID'
  | 'ENTRY_TIMEOUT'
  | 'RUNNER_SPAWN_FAILED';

export interface ExtractionRequest {
  appRoot: string;
  openapiEntry?: string;
}

export interface ExtractOptions {
  timeoutMs?: number;
}

export interface OpenApiDocument {
  openapi: string;
  info: unknown;
  paths: Record<string, unknown>;
  components?: unknown;
  [key: string]: unknown;
}

export interface OpenApiExtractErrorOptions {
  sourcePath?: string;
  cause?: unknown;
}

export class OpenApiExtractError extends Error {
  readonly code: ExtractErrorCode;
  readonly sourcePath?: string;
  override readonly cause?: unknown;

  constructor(code: ExtractErrorCode, message: string, options?: OpenApiExtractErrorOptions) {
    super(message);
    this.name = 'OpenApiExtractError';
    this.code = code;
    this.sourcePath = options?.sourcePath;
    this.cause = options?.cause;
  }
}