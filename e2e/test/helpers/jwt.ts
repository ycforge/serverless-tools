import { randomBytes } from 'node:crypto';
import { SignJWT, exportJWK, exportPKCS8, generateKeyPair, importPKCS8 } from 'jose';

export interface JwtMaterial {
  readonly kid: string;
  readonly privateKeyPem: string;
  readonly jwk: Record<string, unknown>;
}

export async function createJwtMaterial(): Promise<JwtMaterial> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
  const kid = randomBytes(8).toString('hex');
  const jwk = await exportJWK(publicKey);
  jwk.kid = kid;
  jwk.alg = 'RS256';
  jwk.use = 'sig';
  const privateKeyPem = await exportPKCS8(privateKey);
  return { kid, privateKeyPem, jwk };
}

export function jwksDocument(material: JwtMaterial): string {
  return `${JSON.stringify({ keys: [material.jwk] }, null, 2)}\n`;
}

export function openIdConfigurationDocument(issuer: string): string {
  return `${JSON.stringify(
    {
      issuer,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ['id_token'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
    },
    null,
    2,
  )}\n`;
}

export interface SignOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly kid: string;
  readonly privateKeyPem: string;
  readonly subject?: string;
}

export async function signToken(options: SignOptions): Promise<string> {
  const privateKey = await importPKCS8(options.privateKeyPem, 'RS256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: options.kid })
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setSubject(options.subject ?? 'e2e-user')
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);
}
