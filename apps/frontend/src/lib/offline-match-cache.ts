import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MatchMetadata, SequencedMatchEvent } from '@coach-clock/contracts';

export interface OfflineMatchSnapshot {
  readonly matchId: string;
  readonly metadata?: MatchMetadata;
  readonly events: readonly SequencedMatchEvent[];
  readonly savedAt: number;
}

export interface OfflineMatchRepository {
  get(matchId: string): Promise<OfflineMatchSnapshot | undefined>;
  put(snapshot: OfflineMatchSnapshot): Promise<void>;
}

export interface OfflineMatchCache {
  get(matchId: string): Promise<OfflineMatchSnapshot | undefined>;
  saveMetadata(metadata: MatchMetadata): Promise<void>;
  saveEvents(matchId: string, events: readonly SequencedMatchEvent[]): Promise<void>;
}

/**
 * The API remains the authority whenever it is reachable. This small device
 * mirror is only a cold-start fallback: it keeps the last known event log and
 * match metadata together with the IndexedDB outbox, without ever caching API
 * responses in the service worker.
 */
export function createOfflineMatchCache(repository: OfflineMatchRepository): OfflineMatchCache {
  const current = async (matchId: string) =>
    (await repository.get(matchId)) ?? { matchId, events: [], savedAt: 0 };

  return {
    get: (matchId) => repository.get(matchId),
    async saveMetadata(metadata) {
      const snapshot = await current(metadata.id);
      await repository.put({ ...snapshot, metadata, savedAt: Date.now() });
    },
    async saveEvents(matchId, events) {
      const snapshot = await current(matchId);
      await repository.put({ ...snapshot, events: [...events], savedAt: Date.now() });
    },
  };
}

interface OfflineMatchDb extends DBSchema {
  matches: {
    key: string;
    value: OfflineMatchSnapshot;
  };
}

let database: Promise<IDBPDatabase<OfflineMatchDb>> | undefined;

function getDatabase() {
  database ??= openDB<OfflineMatchDb>('coach-clock-offline', 1, {
    upgrade(db) {
      db.createObjectStore('matches', { keyPath: 'matchId' });
    },
  });
  return database;
}

const indexedDbOfflineMatchRepository: OfflineMatchRepository = {
  async get(matchId) {
    return (await getDatabase()).get('matches', matchId);
  },
  async put(snapshot) {
    await (await getDatabase()).put('matches', snapshot);
  },
};

export const offlineMatchCache = createOfflineMatchCache(indexedDbOfflineMatchRepository);
