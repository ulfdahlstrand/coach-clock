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
  /** VAPID är valfritt lokalt, men måste vara komplett när push aktiveras. */
  readonly vapid:
    | { readonly subject: string; readonly publicKey: string; readonly privateKey: string }
    | undefined;
}

function parseVapid(source: NodeJS.ProcessEnv): Env['vapid'] {
  const subject = source['VAPID_SUBJECT']?.trim();
  const publicKey = source['VAPID_PUBLIC_KEY']?.trim();
  const privateKey = source['VAPID_PRIVATE_KEY']?.trim();
  if (subject === undefined && publicKey === undefined && privateKey === undefined)
    return undefined;
  if (subject === undefined || publicKey === undefined || privateKey === undefined) {
    throw new Error(
      'VAPID_SUBJECT, VAPID_PUBLIC_KEY och VAPID_PRIVATE_KEY måste sättas tillsammans',
    );
  }
  if (!/^mailto:|^https:\/\//.test(subject)) {
    throw new Error('VAPID_SUBJECT måste vara en mailto:- eller https:-adress');
  }
  return { subject, publicKey, privateKey };
}

const DEFAULT_PORT = 4002;
const DEFAULT_CORS_ORIGIN = 'http://localhost:5174';
/** Matchar docker/docker-compose.yml. Används aldrig i produktion. */
const DEFAULT_DEV_DATABASE_URL = 'postgres://coach_clock:coach_clock@localhost:5434/coach_clock';

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

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return {
    port: parsePort(source['PORT']),
    corsOrigins: parseCorsOrigins(source['CORS_ORIGIN']),
    databaseUrl: parseDatabaseUrl(source['DATABASE_URL'], source['NODE_ENV']),
    vapid: parseVapid(source),
  };
}
