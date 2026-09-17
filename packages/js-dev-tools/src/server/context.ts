export interface BuildRawContextOptions {
  readonly requestId: string;
  readonly uberTraceId?: string;
  readonly yandexContext: Readonly<Record<string, unknown>>;
}

/**
 * Synthesizes the raw Yandex Cloud Functions runtime context for the
 * connector (S-6, FR-016..020). Deterministic defaults with the provided
 * `yandexContext` merged over them as an explicit override escape hatch; the
 * per-request ids (`awsRequestId`/`requestId`) are never overridden (FR-019).
 */
export function buildRawContext(options: BuildRawContextOptions): Record<string, unknown> {
  const { requestId, uberTraceId, yandexContext } = options;
  const folderId = typeof yandexContext.folderId === 'string' ? yandexContext.folderId : '';

  const base: Record<string, unknown> = {
    awsRequestId: requestId,
    requestId,
    functionName: 'local-function',
    functionVersion: 'local-dev',
    functionFolderId: folderId,
    memoryLimitInMB: '1024',
    deadlineMs: Date.now() + 15000,
    logGroupName: '',
  };

  const merged: Record<string, unknown> = { ...base, ...yandexContext };

  // Optional normalized fields only when actually strings (connector reads
  // optional strings and must never receive a mistyped value).
  if ('token' in yandexContext && typeof yandexContext.token !== 'string') {
    delete merged.token;
  }
  if ('cloudId' in yandexContext && typeof yandexContext.cloudId !== 'string') {
    delete merged.cloudId;
  }

  merged.awsRequestId = requestId;
  merged.requestId = requestId;

  if (uberTraceId !== undefined) {
    merged.uberTraceId = uberTraceId;
  }

  return merged;
}