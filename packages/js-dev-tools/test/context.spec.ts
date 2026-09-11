import { buildRawContext } from '../src/server/context';

const REQUEST_ID = 'req-ctx-0001';

describe('buildRawContext (FR-016..020, S-6)', () => {
  it('always provides the connector-required fields', () => {
    const ctx = buildRawContext({ requestId: REQUEST_ID, yandexContext: {} });
    expect(ctx).toMatchObject({
      awsRequestId: REQUEST_ID,
      requestId: REQUEST_ID,
      functionName: 'local-function',
      functionVersion: 'local-dev',
      functionFolderId: '',
      memoryLimitInMB: '1024',
      logGroupName: '',
    });
    expect(typeof ctx.memoryLimitInMB).toBe('string');
    expect(typeof ctx.deadlineMs).toBe('number');
  });

  it('sets deadlineMs to roughly now + 15000ms', () => {
    const before = Date.now();
    const ctx = buildRawContext({ requestId: REQUEST_ID, yandexContext: {} });
    expect(ctx.deadlineMs).toBeGreaterThanOrEqual(before + 15000);
    expect(ctx.deadlineMs).toBeLessThanOrEqual(Date.now() + 15000);
  });

  it('adds token only when yandexContext.token is a string', () => {
    expect(buildRawContext({ requestId: REQUEST_ID, yandexContext: {} })).not.toHaveProperty(
      'token',
    );
    expect(
      buildRawContext({ requestId: REQUEST_ID, yandexContext: { token: 'secret' } }).token,
    ).toBe('secret');
    expect(
      buildRawContext({ requestId: REQUEST_ID, yandexContext: { token: 123 } }),
    ).not.toHaveProperty('token');
  });

  it('maps folderId and cloudId', () => {
    const ctx = buildRawContext({
      requestId: REQUEST_ID,
      yandexContext: { folderId: 'folder-1', cloudId: 'cloud-1' },
    });
    expect(ctx.functionFolderId).toBe('folder-1');
    expect(ctx.cloudId).toBe('cloud-1');
  });

  it('merges extra yandexContext keys over the defaults', () => {
    const ctx = buildRawContext({
      requestId: REQUEST_ID,
      yandexContext: { functionName: 'custom-fn', custom: 'value' },
    });
    expect(ctx.functionName).toBe('custom-fn');
    expect(ctx.custom).toBe('value');
  });

  it('never lets extra keys override awsRequestId/requestId', () => {
    const ctx = buildRawContext({
      requestId: REQUEST_ID,
      yandexContext: { awsRequestId: 'evil', requestId: 'evil' },
    });
    expect(ctx.awsRequestId).toBe(REQUEST_ID);
    expect(ctx.requestId).toBe(REQUEST_ID);
  });

  it('adds uberTraceId only when provided, verbatim', () => {
    expect(buildRawContext({ requestId: REQUEST_ID, yandexContext: {} })).not.toHaveProperty(
      'uberTraceId',
    );
    const ctx = buildRawContext({
      requestId: REQUEST_ID,
      uberTraceId: 'trace:span:parent:1',
      yandexContext: {},
    });
    expect(ctx.uberTraceId).toBe('trace:span:parent:1');
  });
});
