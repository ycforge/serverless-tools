import { constants, createPrivateKey, createSign } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ResolveIamTokenOptions {
  readonly homeDir?: string;
  readonly iamEndpoint?: string;
  readonly fetchImpl?: typeof fetch;
}

export type IamUnavailableReason =
  | 'no-credential'
  | 'io'
  | 'exchange-error'
  | 'network-error';

/**
 * Resolves an IAM token from the first available source in the canonical
 * priority chain (US3): env → config.yaml OAuth/T1 → SA key JWT (S-8,
 * FR-023..025, R-6). Never throws (fail-open, D-10).
 */
export async function resolveIamToken(
  options: ResolveIamTokenOptions = {},
): Promise<string | undefined> {
  const detail = await resolveIamTokenDetailed(options);
  return detail.token;
}

/** Banner-facing resolver exposing the failure reason on warn paths. */
export async function resolveIamTokenDetailed(
  options: ResolveIamTokenOptions = {},
): Promise<{ token?: string; reason?: IamUnavailableReason }> {
  const homeDir = options.homeDir ?? homedir();
  const iamEndpoint = (options.iamEndpoint ?? 'https://iam.api.cloud.yandex.net').replace(
    /\/+$/,
    '',
  );
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  // Step 1: environment variable (no network).
  const envToken = process.env.YC_IAM_TOKEN;
  if (typeof envToken === 'string' && envToken.length > 0) {
    return { token: envToken };
  }

  // Step 2: ~/.yc/config.yaml — read → current profile → token.
  const ycDir = join(homeDir, '.yc');
  const configPath = join(ycDir, 'config.yaml');
  if (existsSync(configPath)) {
    let profileToken: string | undefined;
    try {
      const parsed = parseYaml(readFileSync(configPath, 'utf8')) as unknown;
      profileToken = readProfileToken(parsed);
    } catch {
      return { reason: 'io' };
    }
    if (typeof profileToken === 'string' && profileToken.length > 0) {
      if (profileToken.startsWith('t1.')) {
        return { token: profileToken };
      }
      const outcome = await exchange(fetchImpl, iamEndpoint, {
        yandexPassportOauthToken: profileToken,
      });
      return mapOutcome(outcome);
    }
  }

  // Step 3: ~/.yc/keys/*.json — first parseable SA key.
  const keysDir = join(ycDir, 'keys');
  if (existsSync(keysDir)) {
    let files: string[];
    try {
      files = readdirSync(keysDir).filter((name) => name.endsWith('.json'));
    } catch {
      return { reason: 'io' };
    }
    for (const file of files) {
      const key = readSaKey(join(keysDir, file));
      if (key === undefined) {
        continue;
      }
      let jwt: string;
      try {
        jwt = signSaJwt(key, iamEndpoint);
      } catch {
        return { reason: 'io' };
      }
      const outcome = await exchange(fetchImpl, iamEndpoint, { jwt });
      return mapOutcome(outcome);
    }
  }

  return { reason: 'no-credential' };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface SaKey {
  readonly service_account_id: string;
  readonly private_key: string;
  readonly id: string;
  readonly key_algorithm: string;
}

function readProfileToken(parsed: unknown): string | undefined {
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const root = parsed as Record<string, unknown>;
  const current = root.current;
  const profiles = root.profiles;
  if (typeof current !== 'string' || typeof profiles !== 'object' || profiles === null) {
    return undefined;
  }
  const profile = (profiles as Record<string, unknown>)[current];
  if (typeof profile !== 'object' || profile === null) {
    return undefined;
  }
  const token = (profile as Record<string, unknown>).token;
  return typeof token === 'string' ? token : undefined;
}

function readSaKey(filePath: string): SaKey | undefined {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (typeof raw !== 'object' || raw === null) {
      return undefined;
    }
    const candidate = raw as Record<string, unknown>;
    if (
      typeof candidate.service_account_id !== 'string' ||
      typeof candidate.private_key !== 'string' ||
      typeof candidate.id !== 'string' ||
      candidate.key_algorithm !== 'RSA_2048'
    ) {
      return undefined;
    }
    return {
      service_account_id: candidate.service_account_id,
      private_key: candidate.private_key,
      id: candidate.id,
      key_algorithm: candidate.key_algorithm,
    };
  } catch {
    return undefined;
  }
}

function signSaJwt(key: SaKey, iamEndpoint: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'PS256', typ: 'JWT', kid: key.id };
  const claims = {
    iss: key.service_account_id,
    aud: `${iamEndpoint}/iam/v1/tokens`,
    iat: now,
    exp: now + 3600,
  };
  const encodedHeader = base64url(new TextEncoder().encode(JSON.stringify(header)));
  const encodedClaims = base64url(new TextEncoder().encode(JSON.stringify(claims)));
  const data = `${encodedHeader}.${encodedClaims}`;
  const pem = key.private_key.replace(/\\n/g, '\n');
  const privateKey = createPrivateKey(pem);
  const signer = createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  const signature = signer.sign({
    key: privateKey,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return `${data}.${base64url(signature)}`;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

type ExchangeOutcome =
  | { readonly kind: 'ok'; readonly token: string }
  | { readonly kind: 'exchange-error' }
  | { readonly kind: 'network-error' };

async function exchange(
  fetchImpl: typeof fetch,
  iamEndpoint: string,
  body: Record<string, unknown>,
): Promise<ExchangeOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`${iamEndpoint}/iam/v1/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'network-error' };
  }
  if (!response.ok) {
    return { kind: 'exchange-error' };
  }
  try {
    const data = (await response.json()) as Record<string, unknown>;
    const token = data.iamToken;
    if (typeof token !== 'string' || token.length === 0) {
      return { kind: 'exchange-error' };
    }
    return { kind: 'ok', token };
  } catch {
    return { kind: 'exchange-error' };
  }
}

function mapOutcome(outcome: ExchangeOutcome): { token?: string; reason?: IamUnavailableReason } {
  if (outcome.kind === 'ok') {
    return { token: outcome.token };
  }
  return { reason: outcome.kind };
}