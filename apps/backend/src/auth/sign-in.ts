/** Från OAuth-identitet till användare — skapar kontot vid första inloggningen. */
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { OAuthProfile } from './google.js';

/**
 * Samma identitet ger alltid samma användare. En ny identitet vars (verifierade)
 * e-post redan har ett konto länkas till det kontot; annars skapas ett nytt.
 */
export async function signInWithProfile(
  db: Kysely<Database>,
  profile: OAuthProfile,
): Promise<string> {
  return db.transaction().execute(async (trx) => {
    const identity = await trx
      .selectFrom('identities')
      .select('user_id')
      .where('provider', '=', profile.provider)
      .where('subject', '=', profile.subject)
      .executeTakeFirst();

    if (identity !== undefined) return identity.user_id;

    const existing = await trx
      .selectFrom('users')
      .select('id')
      .where('email', '=', profile.email)
      .executeTakeFirst();

    const userId =
      existing?.id ??
      (
        await trx
          .insertInto('users')
          .values({ email: profile.email, name: profile.name, image_url: profile.imageUrl })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

    await trx
      .insertInto('identities')
      .values({ user_id: userId, provider: profile.provider, subject: profile.subject })
      .execute();

    return userId;
  });
}
