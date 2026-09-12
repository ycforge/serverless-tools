import { CLIError } from '../cli/errors.js';
import { ComposeError } from '../compose/compose-errors.js';
import { OpenApiExtractError } from '../errors.js';
import { ResourceRefError } from '../resource/errors.js';
import { ARTIFACT_TYPE } from './artifact.js';

export interface BuilderErrorContext {
  readonly appId: string;
  readonly sourcePath: string;
  readonly artifactType: string;
}

export class BuilderError extends Error {
  readonly code: string;
  readonly context: BuilderErrorContext;

  constructor(code: string, message: string, context: BuilderErrorContext) {
    super(message);
    this.name = 'BuilderError';
    this.code = code;
    this.context = context;
  }
}

function codeOf(error: unknown): string | undefined {
  if (error instanceof ResourceRefError || error instanceof OpenApiExtractError) {
    return error.code;
  }
  if (error instanceof CLIError) {
    return error.code;
  }
  if (error instanceof ComposeError) {
    return error.code;
  }
  return undefined;
}

/**
 * Translates any error from the compile pipeline into a fail-fast rejection of
 * `build()` carrying the builder context (artifact type + app identity) for
 * diagnostics (FR-010). Fail-fast: nothing is ever swallowed (constitution V).
 */
export function toBuilderError(
  error: unknown,
  context: Omit<BuilderErrorContext, 'artifactType'>,
): BuilderError {
  const message = error instanceof Error ? error.message : String(error);
  return new BuilderError(
    codeOf(error) ?? 'BUILD_FAILED',
    message,
    { artifactType: ARTIFACT_TYPE, ...context },
  );
}