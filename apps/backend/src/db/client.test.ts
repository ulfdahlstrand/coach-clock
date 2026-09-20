import { afterEach, describe, expect, it } from 'vitest';
import { createDb, destroyDb, getDb } from './client.js';

afterEach(async () => {
  await destroyDb();
});

describe('getDb', () => {
  it('är en singleton — samma instans varje gång', () => {
    expect(getDb()).toBe(getDb());
  });

  it('bygger klienten utan DATABASE_URL och utan körande databas', () => {
    // Hela poängen med den lata singletonen: enhetstester ska kunna importera
    // och konstruera klienten utan databasberoende. Den här sviten körs utan
    // DATABASE_URL satt och utan Postgres igång.
    expect(process.env['DATABASE_URL']).toBeUndefined();
    expect(() => getDb()).not.toThrow();
  });

  it('öppnar ingen anslutning förrän en fråga körs', async () => {
    // En anslutningssträng som garanterat inte går att nå. Att konstruktionen
    // ändå lyckas visar att poolen är lat; felet kommer först vid frågan.
    const db = createDb('postgres://ingen:ingen@127.0.0.1:1/finns-inte');

    await expect(
      db
        .selectFrom('okänd' as never)
        .selectAll()
        .execute(),
    ).rejects.toThrow();
    await db.destroy();
  });

  it('släpper singletonen vid destroyDb så nästa anrop bygger en ny', async () => {
    const first = getDb();
    await destroyDb();

    expect(getDb()).not.toBe(first);
  });
});
