import '../compiler/helpers/noNetwork';
import { describe, it, expect } from 'vitest';
import type { JWTVerifyGetKey } from 'jose';
import { ACCESS_HEADER, CERTS_URL, TEAM_DOMAIN, accessRequired, verifyAccess } from '../../worker/src/access';
import { AUD, KID, keys, otherKey, signToken, unsignedToken } from './helpers/accessKeys';

function request(token?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers[ACCESS_HEADER] = token;
  return new Request('https://stack-seance.enhydrink.com/api/compile', { method: 'POST', headers, body: '{}' });
}

describe('Requirement 9 the Team_Domain and Certs_URL', () => {
  it('are the Access team of the site', () => {
    expect(TEAM_DOMAIN).toBe('https://flat-dust-370d.cloudflareaccess.com');
    expect(CERTS_URL).toBe('https://flat-dust-370d.cloudflareaccess.com/cdn-cgi/access/certs');
    expect(ACCESS_HEADER).toBe('Cf-Access-Jwt-Assertion');
  });
});

describe('Requirement 9.1 to 9.3 verifyAccess', () => {
  it('accepts a valid token', async () => {
    expect(await verifyAccess(request(await signToken()), AUD, keys)).toBe(true);
  });

  it('accepts a token whose aud list holds ACCESS_AUD, and a past nbf', async () => {
    expect(await verifyAccess(request(await signToken({ aud: ['another-app', AUD] })), AUD, keys)).toBe(true);
    expect(await verifyAccess(request(await signToken({}, { notBefore: -60 })), AUD, keys)).toBe(true);
  });

  it('rejects a missing header and an empty one', async () => {
    expect(await verifyAccess(request(), AUD, keys)).toBe(false);
    expect(await verifyAccess(request(''), AUD, keys)).toBe(false);
  });

  it('rejects a token signed by another key, with the kid of the key set', async () => {
    expect(await verifyAccess(request(await signToken({}, { key: otherKey.privateKey })), AUD, keys)).toBe(false);
  });

  it('rejects a token whose kid is not in the key set', async () => {
    expect(await verifyAccess(request(await signToken({}, { kid: `${KID}-rotated` })), AUD, keys)).toBe(false);
  });

  it('rejects a wrong aud and a wrong iss', async () => {
    expect(await verifyAccess(request(await signToken({ aud: 'another-app' })), AUD, keys)).toBe(false);
    expect(await verifyAccess(request(await signToken({ iss: 'https://evil.cloudflareaccess.com' })), AUD, keys)).toBe(false);
    expect(await verifyAccess(request(await signToken({ iss: `${TEAM_DOMAIN}/` })), AUD, keys)).toBe(false);
  });

  it('rejects an expired token, a token whose nbf is in the future, and a token with no exp', async () => {
    expect(await verifyAccess(request(await signToken({}, { expiresIn: -60 })), AUD, keys)).toBe(false);
    expect(await verifyAccess(request(await signToken({}, { notBefore: 600 })), AUD, keys)).toBe(false);
    expect(await verifyAccess(request(await signToken({}, { expiresIn: null })), AUD, keys)).toBe(false);
  });

  it('rejects an alg: none token and text that is not a JWT', async () => {
    expect(await verifyAccess(request(unsignedToken()), AUD, keys)).toBe(false);
    expect(await verifyAccess(request('not.a.jwt'), AUD, keys)).toBe(false);
  });

  it('rejects even a valid token when ACCESS_AUD is empty or missing', async () => {
    const token = await signToken();
    expect(await verifyAccess(request(token), '', keys)).toBe(false);
    expect(await verifyAccess(request(token), undefined, keys)).toBe(false);
    expect(await verifyAccess(request(await signToken({ aud: '' })), '', keys)).toBe(false);
  });

  it('rejects when the key set fails to load', async () => {
    const throwing: JWTVerifyGetKey = () => { throw new Error('certs unreachable'); };
    const rejecting: JWTVerifyGetKey = async () => { throw new Error('certs unreachable'); };
    const token = await signToken();
    expect(await verifyAccess(request(token), AUD, throwing)).toBe(false);
    expect(await verifyAccess(request(token), AUD, rejecting)).toBe(false);
  });
});

describe('Requirement 9.4, 9.5 accessRequired', () => {
  it('is false only for exactly "false"', () => {
    expect(accessRequired({ REQUIRE_ACCESS: 'false' })).toBe(false);
  });

  it('is true for a missing value and anything else', () => {
    for (const value of [undefined, 'true', 'False', 'FALSE', '', ' false', '0', 'no']) {
      expect(accessRequired(value === undefined ? {} : { REQUIRE_ACCESS: value }), JSON.stringify(value)).toBe(true);
    }
  });
});
