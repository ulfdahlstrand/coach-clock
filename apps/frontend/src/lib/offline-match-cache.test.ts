import type { MatchMetadata, SequencedMatchEvent } from '@coach-clock/contracts';
import { describe, expect, it } from 'vitest';
import {
  createOfflineMatchCache,
  type OfflineMatchRepository,
  type OfflineMatchSnapshot,
} from './offline-match-cache';

const match: MatchMetadata = {
  id: '00000000-0000-4000-8000-000000000001',
  teamId: '00000000-0000-4000-8000-000000000002',
  opponent: 'IFK',
  format: 7,
  formationId: '2-3-1',
  periodCount: 3,
  periodLengthSeconds: 600,
  status: 'live',
  joinCode: null,
  createdAt: '2026-09-22T08:00:00.000Z',
  endedAt: null,
};

const event: SequencedMatchEvent = {
  seq: 1,
  receivedAt: '2026-09-22T08:01:00.000Z',
  event: {
    type: 'period_started',
    eventId: '00000000-0000-4000-8000-000000000003',
    matchId: match.id,
    v: 1,
    at: '2026-09-22T08:01:00.000Z',
    by: 'owner',
    periodNumber: 1,
  },
};

function memoryRepository(): OfflineMatchRepository {
  const values = new Map<string, OfflineMatchSnapshot>();
  return {
    get: (matchId) => Promise.resolve(values.get(matchId)),
    put: (snapshot) => {
      values.set(snapshot.matchId, snapshot);
      return Promise.resolve();
    },
  };
}

describe('offline match cache', () => {
  it('keeps metadata and the event log together for a cold offline start', async () => {
    const cache = createOfflineMatchCache(memoryRepository());
    await cache.saveEvents(match.id, [event]);
    await cache.saveMetadata(match);

    await expect(cache.get(match.id)).resolves.toMatchObject({
      metadata: match,
      events: [event],
    });
  });
});
