import { DEFAULT_DEV_DATABASE_URL } from './env.js';

const HOW_TO =
  'Skapa en testdatabas med `npm run docker:test-db` och sätt till exempel i .env:\n' +
  '  TEST_DATABASE_URL=postgres://coach_clock:coach_clock@localhost:5434/coach_clock_test';

/** Värd, port och databasnamn — det som avgör om två adresser är samma databas. */
function databaseIdentity(url: URL): string {
  return `${url.hostname}:${url.port || '5432'}/${url.pathname.replace(/^\//, '')}`;
}

/**
 * Databasen integrationstesterna får köra mot (#78).
 *
 * Testerna rullar ner alla migrationer innan de kör, vilket droppar varje tabell.
 * Tidigare läste de DATABASE_URL — och utan den föll readEnv() tillbaka på
 * utvecklingsdatabasen, så `npm run test:integration` raderade tyst all lokal
 * data. Nu krävs en uttrycklig testdatabas: namnet måste innehålla "test" och
 * den får aldrig vara utvecklingsdatabasen. Hellre ett tydligt fel än tomma
 * tabeller.
 */
export function resolveTestDatabaseUrl(source: NodeJS.ProcessEnv): string {
  const raw = source['TEST_DATABASE_URL']?.trim();
  if (raw === undefined || raw === '') {
    throw new Error(
      'TEST_DATABASE_URL saknas. Integrationstesterna raderar alla tabeller i databasen de ' +
        'kör mot och vägrar därför använda utvecklingsdatabasen.\n' +
        HOW_TO,
    );
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new Error(`TEST_DATABASE_URL går inte att tolka som en databasadress: "${raw}".`);
  }

  const name = target.pathname.replace(/^\//, '');
  const dev = new URL(DEFAULT_DEV_DATABASE_URL);
  if (!/test/i.test(name) || databaseIdentity(target) === databaseIdentity(dev)) {
    throw new Error(
      `TEST_DATABASE_URL pekar på databasen "${name}". Den måste vara en separat ` +
        'testdatabas vars namn innehåller "test" — aldrig utvecklingsdatabasen, eftersom ' +
        'testerna raderar alla tabeller.\n' +
        HOW_TO,
    );
  }

  return raw;
}
