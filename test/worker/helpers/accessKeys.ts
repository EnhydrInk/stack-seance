// A local Access key set for the Worker tests. No test uses createRemoteJWKSet, so no test
// fetches the real certs (Requirement 14.10).
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type GenerateKeyPairResult, type JWTPayload } from 'jose';
import { TEAM_DOMAIN } from '../../../worker/src/access';

export const KID = 'stack-seance-test-key';
export const AUD = 'test-access-aud-tag';

const signing = await generateKeyPair('RS256', { extractable: true });
/** A second key pair, not in the key set, for tokens signed by another key. */
export const otherKey = await generateKeyPair('RS256', { extractable: true });

export const publicJwk = { ...(await exportJWK(signing.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };

/** The key set that `verifyAccess` gets in tests. */
export const keys = createLocalJWKSet({ keys: [publicJwk] });

export interface SignOptions {
  /** The private key to sign with; the key set's own by default. */
  key?: GenerateKeyPairResult['privateKey'];
  kid?: string;
  /** Seconds from now for `exp`, or null to leave `exp` out. Default 3600. */
  expiresIn?: number | null;
  /** Seconds from now for `nbf`, when set. */
  notBefore?: number;
}

/**
 * An RS256 token for `claims`, with `iss` set to the Team_Domain, `aud` to AUD and `exp` one hour
 * ahead unless `claims` or `options` say otherwise.
 */
export async function signToken(claims: JWTPayload = {}, options: SignOptions = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = { iss: TEAM_DOMAIN, aud: AUD, iat: now, email: 'visitor@example.com', ...claims };
  const expiresIn = options.expiresIn === undefined ? 3600 : options.expiresIn;
  if (expiresIn !== null && !('exp' in claims)) payload.exp = now + expiresIn;
  if (options.notBefore !== undefined) payload.nbf = now + options.notBefore;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? KID, typ: 'JWT' })
    .sign(options.key ?? signing.privateKey);
}

/** An unsigned token with `alg: none`, which no RS256 check may accept. */
export function unsignedToken(claims: JWTPayload = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none', kid: KID, typ: 'JWT' })}.${part({ iss: TEAM_DOMAIN, aud: AUD, exp: now + 3600, ...claims })}.`;
}
