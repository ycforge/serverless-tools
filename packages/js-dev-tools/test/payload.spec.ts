import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { buildGatewayV2Event, encodeBody, parseRawQuery, toClfTime } from '../src/server/payload';

const REQUEST_ID = 'req-fixed-0001';

interface RequestOptions {
  readonly url: string;
  readonly method?: string;
  readonly rawHeaders?: string[];
}

function makeRequest(options: RequestOptions): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.method = options.method ?? 'GET';
  req.url = options.url;
  req.rawHeaders = options.rawHeaders ?? [];
  return req;
}

function build(options: RequestOptions, body: Buffer = Buffer.alloc(0)) {
  return buildGatewayV2Event(makeRequest(options), body, { requestId: REQUEST_ID });
}

describe('buildGatewayV2Event (FR-010..015, S-5)', () => {
  it('translates repeated query parameters', () => {
    const event = build({ url: '/api/users?tags=a&tags=b&limit=10' });
    expect(event.version).toBe('2.0');
    expect(event.rawPath).toBe('/api/users');
    expect(event.rawQueryString).toBe('tags=a&tags=b&limit=10');
    expect(event.queryStringParameters).toEqual({ tags: 'a,b', limit: '10' });
    expect(event.multiValueParameters).toEqual({ tags: ['a', 'b'], limit: ['10'] });
  });

  it('translates a JSON POST body as text', () => {
    const body = Buffer.from(JSON.stringify({ name: 'x' }), 'utf8');
    const event = build(
      {
        url: '/api/users',
        method: 'POST',
        rawHeaders: ['Content-Type', 'application/json'],
      },
      body,
    );
    expect(event.requestContext.http.method).toBe('POST');
    expect(event.body).toBe('{"name":"x"}');
    expect(event.isBase64Encoded).toBe(false);
  });

  it('comma-joins duplicate headers in original case', () => {
    const event = build({
      url: '/api/users',
      rawHeaders: ['X-Foo', 'a', 'X-Foo', 'b'],
    });
    expect(event.headers['X-Foo']).toBe('a,b');
  });

  it('base64-encodes binary bodies and round-trips', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);
    const event = build({ url: '/api/blob', method: 'POST' }, png);
    expect(event.isBase64Encoded).toBe(true);
    expect(Buffer.from(event.body, 'base64')).toEqual(png);
  });

  it('leaves empty collections for a bare GET', () => {
    const event = build({ url: '/api/users' });
    expect(event.rawQueryString).toBe('');
    expect(event.queryStringParameters).toEqual({});
    expect(event.multiValueParameters).toEqual({});
    expect(event.pathParameters).toEqual({});
    expect(event.parameters).toEqual({});
    expect(event.operationId).toBe('');
  });

  it('keeps percent-encoded path segments raw (US2-SC6)', () => {
    const event = build({ url: '/api/users%2Factive' });
    expect(event.rawPath).toBe('/api/users%2Factive');
  });

  it('builds requestContext.http.path as rawPath + ? + rawQueryString', () => {
    expect(build({ url: '/api/users?limit=10' }).requestContext.http.path).toBe(
      '/api/users?limit=10',
    );
    expect(build({ url: '/api/users' }).requestContext.http.path).toBe('/api/users?');
  });

  it('formats the CLF timestamp in UTC', () => {
    const event = build({ url: '/api/users' });
    expect(event.requestContext.time).toMatch(
      /^\d{2}\/[A-Z][a-z]{2}\/\d{4}:\d{2}:\d{2}:\d{2} \+0000$/,
    );
    expect(Number.isInteger(event.requestContext.timeEpoch)).toBe(true);
    expect(event.requestContext.timeEpoch).toBe(Math.floor(Date.now() / 1000));
  });

  it('derives sourceIp from X-Forwarded-For with a loopback default', () => {
    expect(
      build({ url: '/api/users', rawHeaders: ['X-Forwarded-For', ' 10.0.0.1 '] }).requestContext.http
        .sourceIp,
    ).toBe('10.0.0.1');
    expect(build({ url: '/api/users' }).requestContext.http.sourceIp).toBe('127.0.0.1');
  });

  it('propagates the User-Agent or an empty string', () => {
    expect(
      build({ url: '/api/users', rawHeaders: ['User-Agent', 'agent/1.0'] }).requestContext.http
        .userAgent,
    ).toBe('agent/1.0');
    expect(build({ url: '/api/users' }).requestContext.http.userAgent).toBe('');
  });

  it('keeps an empty body as text (R-10 documented deviation)', () => {
    const event = build({ url: '/api/users', method: 'POST' });
    expect(event.body).toBe('');
    expect(event.isBase64Encoded).toBe(false);
  });

  it('fills requestContext with the invocation requestId and empty contexts', () => {
    const event = build({ url: '/api/users' });
    expect(event.requestContext.requestId).toBe(REQUEST_ID);
    expect(event.requestContext.authorizer).toEqual({});
    expect(event.requestContext.apiGateway?.operationContext).toEqual({});
  });
});

describe('encodeBody (A-11)', () => {
  it('returns empty text for an empty buffer', () => {
    expect(encodeBody(Buffer.alloc(0))).toEqual({ body: '', isBase64Encoded: false });
  });

  it('treats text content types as UTF-8', () => {
    const body = Buffer.from('hello', 'utf8');
    expect(encodeBody(body, 'text/plain; charset=utf-8')).toEqual({
      body: 'hello',
      isBase64Encoded: false,
    });
    expect(encodeBody(body, 'application/x-www-form-urlencoded')).toEqual({
      body: 'hello',
      isBase64Encoded: false,
    });
  });

  it('base64-encodes non-UTF-8 bytes', () => {
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x81]);
    const encoded = encodeBody(bytes);
    expect(encoded.isBase64Encoded).toBe(true);
    expect(Buffer.from(encoded.body, 'base64')).toEqual(bytes);
  });
});

describe('parseRawQuery (R-8)', () => {
  it('form-decodes plus signs and percent escapes', () => {
    expect(parseRawQuery('q=hello+world&x=%D0%B0')).toEqual({
      values: { q: 'hello world', x: 'а' },
      multi: { q: ['hello world'], x: ['а'] },
    });
  });

  it('falls back to the raw value on a broken escape', () => {
    expect(parseRawQuery('bad=%E0%A4%A').values['bad']).toBe('%E0%A4%A');
  });

  it('returns empty maps for an empty query', () => {
    expect(parseRawQuery('')).toEqual({ values: {}, multi: {} });
  });
});

describe('toClfTime (R-9)', () => {
  it('formats a known UTC instant', () => {
    expect(toClfTime(new Date(Date.UTC(2026, 7, 21, 16, 16, 30)))).toBe(
      '21/Aug/2026:16:16:30 +0000',
    );
  });
});

describe('US2 completeness (T040)', () => {
  it('treats form-urlencoded bodies as text', () => {
    const body = Buffer.from('name=x&role=admin', 'utf8');
    const event = build(
      {
        url: '/api/users',
        method: 'POST',
        rawHeaders: ['Content-Type', 'application/x-www-form-urlencoded'],
      },
      body,
    );
    expect(event.body).toBe('name=x&role=admin');
    expect(event.isBase64Encoded).toBe(false);
  });

  it('passes HEAD and OPTIONS methods through', () => {
    expect(build({ url: '/x', method: 'HEAD' }).requestContext.http.method).toBe('HEAD');
    expect(build({ url: '/x', method: 'OPTIONS' }).requestContext.http.method).toBe('OPTIONS');
  });

  it('comma-joins multiple Set-Cookie request headers', () => {
    const event = build({
      url: '/api/users',
      rawHeaders: ['Set-Cookie', 'a=1; Path=/', 'Set-Cookie', 'b=2; Path=/'],
    });
    expect(event.headers['Set-Cookie']).toBe('a=1; Path=/,b=2; Path=/');
  });

  it('normalizes the HTTP method to uppercase', () => {
    const event = build({ url: '/x', method: 'get' });
    expect(event.requestContext.http.method).toBe('GET');
  });

  it('keeps empty operationContext and authorizer objects', () => {
    const event = build({ url: '/x' });
    expect(event.requestContext.apiGateway?.operationContext).toEqual({});
    expect(event.requestContext.authorizer).toEqual({});
  });
});

describe('Fidelity deviations locked (T110, R-10)', () => {
  it('keeps an empty GET body as "" with isBase64Encoded false', () => {
    const event = build({ url: '/api/users' });
    expect(event.body).toBe('');
    expect(event.isBase64Encoded).toBe(false);
  });

  it('derives requestId from the server-side uuid, ignoring X-Request-Id', () => {
    const event = build({
      url: '/api/users',
      rawHeaders: ['X-Request-Id', 'client-provided-id'],
    });
    expect(event.requestContext.requestId).toBe(REQUEST_ID);
    expect(event.requestContext.requestId).not.toBe('client-provided-id');
  });
});
