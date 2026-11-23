// The Cloudflare Access check (Requirement 9; design.md, "worker/src/access.ts").
// In production `keys` is createRemoteJWKSet(new URL(CERTS_URL)), made once at module scope in
// index.ts: jose picks the key by the token's `kid`, caches the key set for the isolate, and
// fetches it again for a `kid` it does not have, so a key rotation needs no change (9.6).
// Tests pass createLocalJWKSet instead.
import { jwtVerify, type JWTVerifyGetKey } from 'jose';

export const TEAM_DOMAIN = 'https://flat-dust-370d.cloudflareaccess.com';
export const CERTS_URL = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;

/** The request header that holds the Access_Token. */
export const ACCESS_HEADER = 'Cf-Access-Jwt-Assertion';

/** Access_Required: on unless REQUIRE_ACCESS is exactly "false" (9.4, 9.5). */
export function accessRequired(vars: { REQUIRE_ACCESS?: string }): boolean {
  return vars.REQUIRE_ACCESS !== 'false';
}

/**
 * True when the Access_Token is an RS256 JWT from a key of the set, issued by the Team_Domain,
 * for `aud`, not expired and not before its `nbf` (9.1). A missing or empty `aud`, a missing
 * header, and any error, including keys that fail to load, give false (9.2, 9.3).
 */
export async function verifyAccess(request: Request, aud: string | undefined, keys: JWTVerifyGetKey): Promise<boolean> {
  if (!aud) return false;
  const token = request.headers.get(ACCESS_HEADER);
  if (!token) return false;
  try {
    await jwtVerify(token, keys, { issuer: TEAM_DOMAIN, audience: aud, algorithms: ['RS256'], requiredClaims: ['exp'] });
    return true;
  } catch {
    return false;
  }
}
