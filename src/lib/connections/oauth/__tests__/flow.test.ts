import { describe, expect, it, afterEach } from 'vitest';
import {
  generateState, validateState, createPkcePair, redirectUriFor,
  buildAuthorizationUrl, oauthEndpoints,
} from '../flow';
import { setSecret } from '../../secrets';

afterEach(() => { setSecret('X_CLIENT_ID', ''); });

describe('OAuth flow helpers', () => {
  it('generates unique opaque state and validates it', () => {
    const a = generateState();
    const b = generateState();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
    expect(validateState(a, a)).toBe(true);
    expect(validateState(a, b)).toBe(false);
    expect(validateState(undefined, a)).toBe(false);
  });

  it('creates a PKCE S256 pair (challenge differs from verifier, url-safe)', async () => {
    const { verifier, challenge, method } = await createPkcePair();
    expect(method).toBe('S256');
    expect(challenge).not.toBe(verifier);
    expect(challenge).not.toMatch(/[+/=]/); // base64url
  });

  it('uses a single shared loopback redirect origin for every provider', () => {
    // No per-provider redirect keys; all share LARUND_OAUTH_CALLBACK_BASE.
    const gh = redirectUriFor('github');
    expect(gh).toMatch(/^http:\/\/localhost:\d+\/$/);
    expect(redirectUriFor('google-workspace')).toBe(gh);
    expect(redirectUriFor('x')).toBe(gh);
  });

  it('builds an authorize URL with PKCE for X, honoring a redirect override', () => {
    setSecret('X_CLIENT_ID', 'x-client-id');
    const state = generateState();
    const redirect = 'http://localhost:14200/';
    const { url, redirectUri, usesPkce } = buildAuthorizationUrl({ providerId: 'x', state, codeChallenge: 'CHAL', redirectUri: redirect });
    expect(usesPkce).toBe(true);
    expect(url).toContain(oauthEndpoints('x')!.authorizeUrl);
    expect(url).toContain('client_id=x-client-id');
    expect(url).toContain('response_type=code');
    expect(url).toContain(`state=${state}`);
    expect(url).toContain('code_challenge=CHAL');
    expect(url).toContain('code_challenge_method=S256');
    expect(redirectUri).toBe(redirect);
    expect(decodeURIComponent(url)).toContain('http://localhost:14200/');
    expect(decodeURIComponent(url)).toContain('tweet.read');
  });

  it('refuses to build an authorize URL when developer setup is missing', () => {
    // GitHub client id is empty in the repo .env → developer_setup_missing.
    expect(() => buildAuthorizationUrl({ providerId: 'github', state: 's' })).toThrow(/developer_setup_missing/);
  });
});
