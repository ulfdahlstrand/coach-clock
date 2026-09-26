/**
 * All konfiguration läses ur miljövariabler — inget hårdkodas och inget
 * hemligt hamnar i källkoden.
 */
export interface Env {
  /** Porten API:t lyssnar på. 4002 för att inte krocka med fc-apps 4001. */
  readonly port: number;
  /** Tillåtna origins för CORS. Tom lista = inga cross-origin-anrop släpps in. */
  readonly corsOrigins: readonly string[];
  /** Anslutningssträng till Postgres. */
  readonly databaseUrl: string;
  /** Tränarinloggningen (ADR-001). */
  readonly auth: AuthEnv;
}

export interface GoogleAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** Måste ligga på webbens origin (`…/api/auth/google/callback`) — det är svaret som sätter sessionscookien. */
  readonly callbackUrl: string;
}

export interface AuthEnv {
  /** Null utanför produktion när inget Google-klient-id är satt; inloggningen svarar då 503. */
  readonly google: GoogleAuthConfig | null;
  /** Dit webbläsaren skickas efter inloggning. */
  readonly frontendUrl: string;
  /** `Secure` på sessionscookien. På som standard i produktion. */
  readonly cookieSecure: boolean;
  /** Utvecklingsinloggning utan Google. Kan aldrig slås på i produktion. */
  readonly devLogin: boolean;
}

const DEFAULT_PORT = 4002;
const DEFAULT_CORS_ORIGIN = 'http://localhost:5174';
/** Matchar docker/docker-compose.yml. Används aldrig i produktion. */
export const DEFAULT_DEV_DATABASE_URL =
  'postgres://coach_clock:coach_clock@localhost:5434/coach_clock';

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PORT;
  }

  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT måste vara ett heltal mellan 1 och 65535, fick "${raw}"`);
  }

  return port;
}

function parseCorsOrigins(raw: string | undefined): readonly string[] {
  const value = raw === undefined || raw.trim() === '' ? DEFAULT_CORS_ORIGIN : raw;

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

function parseDatabaseUrl(raw: string | undefined, nodeEnv: string | undefined): string {
  if (raw !== undefined && raw.trim() !== '') {
    return raw.trim();
  }

  // Utanför produktion är den lokala docker-databasen en rimlig default. I
  // produktion är den det aldrig — då ska ett saknat DATABASE_URL stoppa starten
  // istället för att tyst peka på localhost.
  if (nodeEnv === 'production') {
    throw new Error('DATABASE_URL måste sättas i produktion');
  }

  return DEFAULT_DEV_DATABASE_URL;
}

function present(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function parseGoogle(source: NodeJS.ProcessEnv): GoogleAuthConfig | null {
  const clientId = present(source['GOOGLE_CLIENT_ID']);
  const clientSecret = present(source['GOOGLE_CLIENT_SECRET']);
  const callbackUrl = present(source['AUTH_CALLBACK_URL']);

  if (clientId !== undefined && clientSecret !== undefined && callbackUrl !== undefined) {
    return { clientId, clientSecret, callbackUrl };
  }

  // Utan Google kan ingen tränare logga in, och då går inga lag att nå. I
  // produktion är det ett konfigurationsfel som ska stoppa starten, inte en
  // app som ser ut att fungera tills någon trycker på "Logga in".
  if (source['NODE_ENV'] === 'production') {
    throw new Error(
      'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET och AUTH_CALLBACK_URL måste sättas i produktion',
    );
  }

  return null;
}

function parseAuth(source: NodeJS.ProcessEnv): AuthEnv {
  const production = source['NODE_ENV'] === 'production';
  const frontendUrl = present(source['FRONTEND_URL']);

  if (frontendUrl === undefined && production) {
    throw new Error('FRONTEND_URL måste sättas i produktion');
  }

  const cookieSecure = present(source['COOKIE_SECURE']);

  return {
    google: parseGoogle(source),
    frontendUrl: new URL(frontendUrl ?? DEFAULT_CORS_ORIGIN).origin,
    cookieSecure: cookieSecure === undefined ? production : cookieSecure === 'true',
    devLogin: !production && source['ENABLE_DEV_LOGIN'] === 'true',
  };
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return {
    port: parsePort(source['PORT']),
    corsOrigins: parseCorsOrigins(source['CORS_ORIGIN']),
    databaseUrl: parseDatabaseUrl(source['DATABASE_URL'], source['NODE_ENV']),
    auth: parseAuth(source),
  };
}
