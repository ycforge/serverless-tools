import {
  JDT_ENTRY_RESOLVE_FAILED,
  JDT_INVALID_PORT,
  JDT_MQ_UNSUPPORTED,
  JDT_NO_TRANSPORT,
  LocalDevServerError,
} from './diagnostics';

export interface YcsfLocalServerOptions {
  /** Path to the root NestJS application module (relative to cwd, FR-005). */
  readonly entry: string;
  /** Enables the API Gateway v2 HTTP transport (default true, FR-004). */
  readonly apiGatewayV2?: boolean;
  /** Explicitly unsupported in v1: enabling it fails fast (FR-004). */
  readonly messageQueue?: boolean;
  /** Port to bind on 127.0.0.1 (default 3000, integer in [0, 65535]). */
  readonly port?: number;
  /** Inputs for raw runtime-context synthesis (S-6, FR-016..018). */
  readonly yandexContext?: Readonly<Record<string, unknown>>;
}

const MIN_PORT = 0;
const MAX_PORT = 65535;

/** Fully-validated option bag: every field resolved to a concrete value. */
export type ValidatedLocalDevServerOptions = {
  readonly entry: string;
  readonly apiGatewayV2: boolean;
  readonly messageQueue: boolean;
  readonly port: number;
  readonly yandexContext: Readonly<Record<string, unknown>>;
};

/**
 * Fail-fast option validation (FR-004): the most declarative constraints win,
 * so a Message Queue request or a missing transport reject before the entry
 * path is even considered. Every failure carries a JDT_* diagnostic code.
 */
export function validateOptions(options: unknown): ValidatedLocalDevServerOptions {
  if (typeof options !== 'object' || options === null) {
    throw new LocalDevServerError(
      JDT_ENTRY_RESOLVE_FAILED,
      'options must be an object with an entry path',
    );
  }
  const bag = options as Record<string, unknown>;

  const messageQueue = bag.messageQueue === true;
  if (messageQueue) {
    throw new LocalDevServerError(
      JDT_MQ_UNSUPPORTED,
      'messageQueue transport is not supported by local dev server',
    );
  }

  const apiGatewayV2 = bag.apiGatewayV2 !== false;
  if (!apiGatewayV2 && !messageQueue) {
    throw new LocalDevServerError(
      JDT_NO_TRANSPORT,
      'at least one transport must be enabled (apiGatewayV2)',
    );
  }

  const rawPort = bag.port === undefined ? 3000 : bag.port;
  if (
    typeof rawPort !== 'number' ||
    !Number.isInteger(rawPort) ||
    rawPort < MIN_PORT ||
    rawPort > MAX_PORT
  ) {
    throw new LocalDevServerError(
      JDT_INVALID_PORT,
      `port must be an integer in [${MIN_PORT}, ${MAX_PORT}]`,
    );
  }

  const entry = bag.entry;
  if (typeof entry !== 'string' || entry.length === 0) {
    throw new LocalDevServerError(
      JDT_ENTRY_RESOLVE_FAILED,
      'entry must be a non-empty path to the application module',
    );
  }

  const yandexContext =
    typeof bag.yandexContext === 'object' && bag.yandexContext !== null
      ? (bag.yandexContext as Readonly<Record<string, unknown>>)
      : {};

  return { entry, apiGatewayV2, messageQueue, port: rawPort, yandexContext };
}