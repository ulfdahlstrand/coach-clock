import { describe, expect, it } from 'vitest';
import { exchangeGoogleCode, getGoogleAuthUrl, profileFromIdToken } from './google.js';

const config = {
  clientId: 'klient-id',
  clientSecret: 'hemlig',
  callbackUrl: 'https://web.se/api/auth/google/callback',
};

function idToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signatur`;
}

describe('getGoogleAuthUrl', () => {
  it('ber om openid, e-post och profil och skickar med state', () => {
    const url = new URL(getGoogleAuthUrl(config, 'abc'));
    expect(url.searchParams.get('redirect_uri')).toBe(config.callbackUrl);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('abc');
    expect(url.searchParams.has('client_secret')).toBe(false);
  });
});

describe('profileFromIdToken', () => {
  it('läser profilen och normaliserar e-posten', () => {
    expect(
      profileFromIdToken(
        idToken({
          sub: '123',
          email: 'Ulf@Example.se',
          email_verified: true,
          name: 'Ulf',
          picture: 'https://bild',
        }),
      ),
    ).toEqual({
      provider: 'google',
      subject: '123',
      email: 'ulf@example.se',
      name: 'Ulf',
      imageUrl: 'https://bild',
    });
  });

  it('avvisar en e-postadress som Google inte har verifierat', () => {
    expect(() => profileFromIdToken(idToken({ sub: '1', email: 'a@b.se' }))).toThrow(/verifierad/);
    expect(() =>
      profileFromIdToken(idToken({ sub: '1', email: 'a@b.se', email_verified: false })),
    ).toThrow(/verifierad/);
  });

  it('avvisar en trasig token', () => {
    expect(() => profileFromIdToken('inte-en-jwt')).toThrow();
  });
});

describe('exchangeGoogleCode', () => {
  it('växlar koden med klienthemligheten mot Googles tokenendpoint', async () => {
    let body: unknown;
    const fetchImpl: typeof fetch = (_url, init) => {
      body = init?.body;
      return Promise.resolve(
        Response.json({ id_token: idToken({ sub: '1', email: 'a@b.se', email_verified: true }) }),
      );
    };

    await expect(exchangeGoogleCode(config, 'kod', fetchImpl)).resolves.toMatchObject({
      subject: '1',
    });
    expect(body).toBeInstanceOf(URLSearchParams);
    const params = body as URLSearchParams;
    expect(params.get('code')).toBe('kod');
    expect(params.get('client_secret')).toBe('hemlig');
    expect(params.get('grant_type')).toBe('authorization_code');
  });

  it('kastar när Google avvisar koden', async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response('invalid_grant', { status: 400 }));
    await expect(exchangeGoogleCode(config, 'kod', fetchImpl)).rejects.toThrow(/400/);
  });
});
