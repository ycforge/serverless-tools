import { constants, generateKeyPairSync, verify } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveIamToken, resolveIamTokenDetailed } from '../src/server/iam';

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), 'jdt-iam-'));
}

function writeConfig(home: string, content: string): void {
  mkdirSync(join(home, '.yc'), { recursive: true });
  writeFileSync(join(home, '.yc', 'config.yaml'), content, 'utf8');
}

function writeKey(home: string, name: string, data: unknown): void {
  mkdirSync(join(home, '.yc', 'keys'), { recursive: true });
  writeFileSync(
    join(home, '.yc', 'keys', name),
    typeof data === 'string' ? data : JSON.stringify(data),
    'utf8',
  );
}

function makeFetch(response: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  throws?: Error;
}) {
  return vi.fn(async (_url: string, _init: unknown = {}): Promise<unknown> => {
    if (response.throws) {
      throw response.throws;
    }
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async (): Promise<unknown> => response.json,
    };
  });
}

function iamOptions(home: string, fetchImpl: ReturnType<typeof makeFetch>) {
  return { homeDir: home, fetchImpl: fetchImpl as unknown as typeof fetch };
}

const validKeyAlgorithm = 'RSA_2048';
let sshKeyPair: { privatePem: string; publicPem: string } | undefined;

function rsaKeyPair(): { privatePem: string; publicPem: string } {
  if (!sshKeyPair) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    sshKeyPair = {
      privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      publicPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    };
  }
  return sshKeyPair;
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

describe('resolveIamToken (FR-023..025, S-8)', () => {
  beforeEach(() => {
    vi.stubEnv('YC_IAM_TOKEN', '');
    sshKeyPair = undefined;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses a non-empty YC_IAM_TOKEN without touching the network (US3-SC1)', async () => {
    vi.stubEnv('YC_IAM_TOKEN', 'abc');
    const home = tempHome();
    const fetchImpl = makeFetch({ json: { iamToken: 'never' } });

    const result = await resolveIamToken(iamOptions(home, fetchImpl));

    expect(result).toBe('abc');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exchanges an OAuth profile token from ~/.yc/config.yaml (US3-SC2)', async () => {
    const home = tempHome();
    writeConfig(home, 'current: dev\nprofiles:\n  dev:\n    token: oauth-token-1\n');
    const fetchImpl = makeFetch({ json: { iamToken: 'iam-from-oauth' } });

    const result = await resolveIamToken(iamOptions(home, fetchImpl));

    expect(result).toBe('iam-from-oauth');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0]!;
    expect(String(call[0])).toBe('https://iam.api.cloud.yandex.net/iam/v1/tokens');
    const body = JSON.parse(String((call[1] as { body: string }).body)) as Record<string, string>;
    expect(body).toEqual({ yandexPassportOauthToken: 'oauth-token-1' });
  });

  it('signs a PS256 JWT from the first parseable service-account key (US3-SC3)', async () => {
    const home = tempHome();
    const { privatePem, publicPem } = rsaKeyPair();
    writeKey(home, 'sa-key.json', {
      id: 'key-id-1',
      service_account_id: 'sa-123',
      private_key: privatePem.replace(/\n/g, '\\n'),
      key_algorithm: validKeyAlgorithm,
    });
    const fetchImpl = makeFetch({ json: { iamToken: 'iam-from-sa' } });

    const result = await resolveIamToken(iamOptions(home, fetchImpl));

    expect(result).toBe('iam-from-sa');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(String((call[1] as { body: string }).body)) as Record<string, string>;
    const jwt = body.jwt as string;
    const [headerB64, claimsB64, signatureB64] = jwt.split('.');
    const header = decodeSegment(headerB64 ?? '');
    expect(header.alg).toBe('PS256');
    expect(header.typ).toBe('JWT');
    expect(header.kid).toBe('key-id-1');
    const claims = decodeSegment(claimsB64 ?? '') as Record<string, number | string>;
    expect(claims.iss).toBe('sa-123');
    expect(claims.aud).toBe('https://iam.api.cloud.yandex.net/iam/v1/tokens');
    expect(Number(claims.exp) - Number(claims.iat)).toBe(3600);
    const valid = verify(
      'sha256',
      Buffer.from(`${headerB64}.${claimsB64}`),
      { key: publicPem, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST },
      Buffer.from(signatureB64 ?? '', 'base64url'),
    );
    expect(valid).toBe(true);
  });

  it('prefers the environment token over a populated config (US3-SC4 priority)', async () => {
    vi.stubEnv('YC_IAM_TOKEN', 'env-wins');
    const home = tempHome();
    writeConfig(home, 'current: dev\nprofiles:\n  dev:\n    token: oauth-token\n');
    const fetchImpl = makeFetch({ json: { iamToken: 'existing' }, throws: new Error('network must be skipped') });

    const result = await resolveIamToken(iamOptions(home, fetchImpl));

    expect(result).toBe('env-wins');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails open with reason no-credential when nothing is configured (US3-SC5)', async () => {
    const home = tempHome();
    const fetchImpl = makeFetch({ json: { iamToken: 'unused' } });

    const detail = await resolveIamTokenDetailed(iamOptions(home, fetchImpl));

    expect(detail).toEqual({ reason: 'no-credential' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats an empty config token as absent and falls through (US3-SC6)', async () => {
    const home = tempHome();
    writeConfig(home, 'current: dev\nprofiles:\n  dev:\n    token: ""\n');

    const result = await resolveIamToken(iamOptions(home, makeFetch({ json: {} })));

    expect(result).toBeUndefined();
  });

  it('returns a t1.-prefixed config token as-is without an exchange', async () => {
    const home = tempHome();
    writeConfig(home, 'current: dev\nprofiles:\n  dev:\n    token: t1.abc123\n');
    const fetchImpl = makeFetch({ json: { iamToken: 'unused' } });

    const result = await resolveIamToken(iamOptions(home, fetchImpl));

    expect(result).toBe('t1.abc123');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails open with reason io for an invalid service-account PEM', async () => {
    const home = tempHome();
    writeKey(home, 'sa-key.json', {
      id: 'key-id-1',
      service_account_id: 'sa-123',
      private_key: 'garbage\\nnot-a-pem',
      key_algorithm: validKeyAlgorithm,
    });

    const detail = await resolveIamTokenDetailed(iamOptions(home, makeFetch({ json: {} })));

    expect(detail.token).toBeUndefined();
    expect(['io']).toContain(detail.reason);
  });

  it('reports a network failure as network-error', async () => {
    const home = tempHome();
    writeConfig(home, 'current: dev\nprofiles:\n  dev:\n    token: oauth-token\n');
    const fetchImpl = makeFetch({ throws: new Error('ECONNREFUSED') });

    const detail = await resolveIamTokenDetailed(iamOptions(home, fetchImpl));

    expect(detail).toEqual({ reason: 'network-error' });
  });

  it('reports an IAM API non-2xx response as exchange-error', async () => {
    const home = tempHome();
    writeConfig(home, 'current: dev\nprofiles:\n  dev:\n    token: oauth-token\n');
    const fetchImpl = makeFetch({ ok: false, status: 401, json: { message: 'denied' } });

    const detail = await resolveIamTokenDetailed(iamOptions(home, fetchImpl));

    expect(detail).toEqual({ reason: 'exchange-error' });
  });

  it('reports a malformed config as io', async () => {
    const home = tempHome();
    writeConfig(home, 'a: {unclosed\n');

    const detail = await resolveIamTokenDetailed(iamOptions(home, makeFetch({ json: {} })));

    expect(detail).toEqual({ reason: 'io' });
  });

  it('skips an unparseable SA key and uses the next parseable one', async () => {
    const home = tempHome();
    const { privatePem } = rsaKeyPair();
    writeKey(home, 'a-broken.json', '{invalid json');
    writeKey(home, 'b-valid.json', {
      id: 'key-id-1',
      service_account_id: 'sa-123',
      private_key: privatePem.replace(/\n/g, '\\n'),
      key_algorithm: validKeyAlgorithm,
    });
    const fetchImpl = makeFetch({ json: { iamToken: 'iam-from-sa' } });

    const detail = await resolveIamTokenDetailed(iamOptions(home, fetchImpl));

    expect(detail.token).toBe('iam-from-sa');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0]!;
    const body = JSON.parse(String((call[1] as { body: string }).body)) as Record<string, string>;
    const [headerB64] = (body.jwt ?? '').split('.');
    const header = decodeSegment(headerB64 ?? '');
    expect(header.kid).toBe('key-id-1');
  });

  it('fails open with reason no-credential when no keys file is parseable', async () => {
    const home = tempHome();
    writeKey(home, 'bad1.json', '{invalid json');
    writeKey(home, 'bad2.json', '[]');
    const fetchImpl = makeFetch({ json: { iamToken: 'unused' } });

    const detail = await resolveIamTokenDetailed(iamOptions(home, fetchImpl));

    expect(detail).toEqual({ reason: 'no-credential' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});