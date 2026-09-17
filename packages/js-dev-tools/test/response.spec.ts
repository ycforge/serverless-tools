import type { ServerResponse } from 'node:http';
import {
  applyEnvelope,
  errorResponse,
  isYandexFunctionHttpResponse,
} from '../src/server/response';
import type { YandexFunctionHttpResponse } from '@ycforge/nestjs-connector';

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  chunks: Buffer[];
  ended: boolean;
  setHeader(name: string, value: string): void;
  appendHeader(name: string, value: string): void;
  end(data?: string | Buffer): void;
}

function makeResponse(): { res: ServerResponse; fake: FakeResponse } {
  const fake: FakeResponse = {
    statusCode: 200,
    headers: {},
    chunks: [],
    ended: false,
    setHeader(name, value) {
      fake.headers[name] = value;
    },
    appendHeader(name, value) {
      const existing = fake.headers[name];
      if (existing === undefined) {
        fake.headers[name] = [value];
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        fake.headers[name] = [existing, value];
      }
    },
    end(data) {
      fake.ended = true;
      if (data !== undefined) {
        fake.chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
      }
    },
  };
  return { res: fake as unknown as ServerResponse, fake };
}

function bodyOf(fake: FakeResponse): Buffer {
  return Buffer.concat(fake.chunks);
}

function envelope(overrides: Partial<YandexFunctionHttpResponse> = {}): YandexFunctionHttpResponse {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    isBase64Encoded: false,
    ...overrides,
  };
}

describe('applyEnvelope (FR-021, S-7)', () => {
  it('applies the envelope status code and single headers', () => {
    const { res, fake } = makeResponse();
    applyEnvelope(
      res,
      envelope({ statusCode: 201, headers: { 'X-Custom': 'v' }, body: '{"ok":true}' }),
      'trace-1',
    );
    expect(fake.statusCode).toBe(201);
    expect(fake.headers['X-Custom']).toBe('v');
    expect(fake.ended).toBe(true);
    expect(bodyOf(fake).toString('utf8')).toBe('{"ok":true}');
  });

  it('emits multiValueHeaders as separate header entries (Set-Cookie without comma-join)', () => {
    const { res, fake } = makeResponse();
    applyEnvelope(
      res,
      envelope({
        multiValueHeaders: { 'Set-Cookie': ['a=1', 'b=2'] },
      }),
      'trace-1',
    );
    expect(fake.headers['Set-Cookie']).toEqual(['a=1', 'b=2']);
    expect(bodyOf(fake).length).toBe(0);
  });

  it('decodes base64 bodies to raw bytes', () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x81]);
    const { res, fake } = makeResponse();
    applyEnvelope(
      res,
      envelope({ isBase64Encoded: true, body: bytes.toString('base64') }),
      'trace-1',
    );
    expect(bodyOf(fake)).toEqual(bytes);
  });

  it('always echoes X-Trace-Id after the envelope', () => {
    const { res, fake } = makeResponse();
    applyEnvelope(
      res,
      envelope({ headers: { 'X-Trace-Id': 'app-supplied' }, body: 'x' }),
      'trace-invocation',
    );
    expect(fake.headers['X-Trace-Id']).toBe('trace-invocation');
  });
});

describe('errorResponse (FR-022, S-7)', () => {
  it('writes JSON { error, message, trace_id } with X-Trace-Id', () => {
    const { res, fake } = makeResponse();
    errorResponse(res, 500, new Error('boom'), 'trace-er');
    expect(fake.statusCode).toBe(500);
    expect(fake.headers['X-Trace-Id']).toBe('trace-er');
    const payload = JSON.parse(bodyOf(fake).toString('utf8')) as Record<string, string>;
    expect(payload).toEqual({ error: 'Error', message: 'boom', trace_id: 'trace-er' });
  });

  it('redacts sensitive values from the message', () => {
    const { res, fake } = makeResponse();
    errorResponse(res, 500, new Error('failed with token=abc-123'), 'trace-er', [
      'abc-123',
    ]);
    const payload = JSON.parse(bodyOf(fake).toString('utf8')) as Record<string, string>;
    expect(payload.message).toBe('failed with token=[REDACTED]');
  });
});

describe('isYandexFunctionHttpResponse (S-7)', () => {
  it('recognizes a valid envelope', () => {
    expect(
      isYandexFunctionHttpResponse(
        envelope({ statusCode: 200, headers: { a: 'b' }, body: 'x' }),
      ),
    ).toBe(true);
    expect(
      isYandexFunctionHttpResponse(
        envelope({ isBase64Encoded: true, body: Buffer.from('x').toString('base64') }),
      ),
    ).toBe(true);
  });

  it.each<[value: unknown, label: string]>([
    [[], 'array'],
    ['string', 'string'],
    [null, 'null'],
    [{}, 'missing every field'],
    [{ statusCode: '200', body: 'x', isBase64Encoded: false }, 'non-numeric status'],
    [{ statusCode: 200, body: 5, isBase64Encoded: false }, 'non-string body'],
  ])('%# rejects', (value) => {
    expect(isYandexFunctionHttpResponse(value)).toBe(false);
  });
});