// spec 017 moves — MOV_* diagnostic factory (pure transform, no file context).
import type { MovesDiagnostic, MoveEndpoint } from '../contracts/index.js';

export { diag } from '../model/errors.js';

export interface MovOptions {
  readonly code: string;
  readonly message: string;
  readonly entry?: number;
  readonly endpoint?: MoveEndpoint;
  readonly field?: string;
  readonly available?: readonly string[];
}

export function mov(opts: MovOptions): MovesDiagnostic {
  const diagnostic: {
    code: string;
    message: string;
    entry?: number;
    endpoint?: MoveEndpoint;
    field?: string;
    available?: readonly string[];
  } = { code: opts.code, message: opts.message };
  if (opts.entry !== undefined) diagnostic.entry = opts.entry;
  if (opts.endpoint !== undefined) diagnostic.endpoint = opts.endpoint;
  if (opts.field !== undefined) diagnostic.field = opts.field;
  if (opts.available !== undefined) diagnostic.available = opts.available;
  return diagnostic as MovesDiagnostic;
}