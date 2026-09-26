/**
 * Små cookiehjälpare — tillräckligt för sessions-, state- och deltagarcookien
 * utan ett extra beroende.
 */

export function parseCookies(header: string | undefined): Readonly<Record<string, string>> {
  const cookies: Record<string, string> = {};
  if (header === undefined) return cookies;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    const raw = part.slice(separator + 1).trim();
    if (name === '' || raw === '') continue;
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      // En trasig cookie från någon annan på samma värd ska inte fälla requesten.
    }
  }

  return cookies;
}

export interface CookieOptions {
  /** `Secure` — styrs av COOKIE_SECURE / produktion (env.ts). */
  readonly secure: boolean;
  /** Absolut utgång. Utelämnad blir det en sessionscookie; ett passerat datum rensar den. */
  readonly expires?: Date;
  readonly maxAgeSeconds?: number;
}

/**
 * Serialiserar en HttpOnly-cookie.
 *
 * `SameSite=Lax` utan undantag: webbläsaren når alltid API:t på sidans eget
 * origin — genom /api-rewriten driftsatt, på localhost i utveckling. `None`
 * skulle inte köpa något och tappa det CSRF-skydd `Lax` ger.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.expires !== undefined) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

/** En cookie som går ut direkt, dvs. rensar den namngivna cookien. */
export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, '', { secure, expires: new Date(0) });
}
