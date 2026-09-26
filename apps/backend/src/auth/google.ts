/** Google OAuth: omdirigeringen och kodväxlingen (ADR-001). */
import { z } from 'zod';
import type { GoogleAuthConfig } from '../env.js';

const AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

export interface OAuthProfile {
  readonly provider: 'google';
  readonly subject: string;
  readonly email: string;
  readonly name: string;
  readonly imageUrl: string | null;
}

export function getGoogleAuthUrl(config: GoogleAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
  });
  return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
}

const idTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().min(1),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

const tokenResponseSchema = z.object({ id_token: z.string() });

/**
 * id_token-signaturen verifieras inte: token kommer direkt från Googles
 * tokenendpoint över TLS, i utbyte mot en kod som bara vår klienthemlighet kan
 * lösa in. Det är exakt det fall OIDC Core 3.1.3.7 tillåter.
 */
export function decodeJwtPayload(jwt: string): unknown {
  const payload = jwt.split('.')[1];
  if (payload === undefined || payload === '') {
    throw new Error('Trasig id_token från Google');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/** Tolkar id_tokenns anspråk. En overifierad e-postadress avvisas. */
export function profileFromIdToken(idToken: string): OAuthProfile {
  const claims = idTokenClaimsSchema.parse(decodeJwtPayload(idToken));

  // Konton länkas på e-post. En adress Google inte har verifierat bevisar
  // ingenting och får därför inte länka till — eller skapa — ett konto.
  if (claims.email_verified !== true) {
    throw new Error('Google-kontots e-postadress är inte verifierad');
  }

  return {
    provider: 'google',
    subject: claims.sub,
    email: claims.email.toLowerCase(),
    name: claims.name ?? claims.email,
    imageUrl: claims.picture ?? null,
  };
}

export async function exchangeGoogleCode(
  config: GoogleAuthConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuthProfile> {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    // Kroppen loggas men följer aldrig med till webbläsaren.
    throw new Error(
      `Googles kodväxling misslyckades (${response.status}): ${await response.text()}`,
    );
  }

  const { id_token: idToken } = tokenResponseSchema.parse(await response.json());
  return profileFromIdToken(idToken);
}
