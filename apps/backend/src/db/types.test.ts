import { describe, expect, it } from 'vitest';
import {
  toMatch,
  toParticipant,
  toPlayer,
  toStoredMatchEvent,
  toTeam,
  type MatchEventTable,
  type MatchTable,
  type ParticipantTable,
  type PlayerTable,
  type TeamTable,
} from './types.js';
import type { Selectable } from 'kysely';

const createdAt = new Date('2026-09-20T10:00:00.000Z');

const teamRow: Selectable<TeamTable> = {
  id: 'team-1',
  name: 'P13 Blå',
  created_at: createdAt,
};

const matchRow: Selectable<MatchTable> = {
  id: 'match-1',
  team_id: 'team-1',
  opponent: 'Grön IF',
  format: 9,
  formation_id: '9-3-3-2',
  period_count: 2,
  period_length_seconds: 1500,
  status: 'live',
  join_code: 'ABC123',
  join_token_hash: 'a'.repeat(64),
  created_at: createdAt,
  ended_at: null,
};

const participantRow: Selectable<ParticipantTable> = {
  id: 'participant-1',
  match_id: 'match-1',
  role: 'coach',
  display_name: 'Ulf',
  token_hash: 'b'.repeat(64),
  created_at: createdAt,
  last_seen_at: createdAt,
};

describe('toTeam', () => {
  it('översätter snake_case till camelCase', () => {
    expect(toTeam(teamRow)).toEqual({ id: 'team-1', name: 'P13 Blå', createdAt });
  });
});

describe('toPlayer', () => {
  it('behåller ett saknat tröjnummer som null', () => {
    const row: Selectable<PlayerTable> = {
      id: 'player-1',
      team_id: 'team-1',
      name: 'Alva',
      number: null,
      is_goalkeeper: false,
      archived: false,
    };

    expect(toPlayer(row)).toEqual({
      id: 'player-1',
      teamId: 'team-1',
      name: 'Alva',
      number: null,
      isGoalkeeper: false,
      archived: false,
    });
  });
});

describe('toMatch', () => {
  it('översätter raden till domänens fältnamn', () => {
    expect(toMatch(matchRow)).toMatchObject({
      teamId: 'team-1',
      formationId: '9-3-3-2',
      periodCount: 2,
      periodLengthSeconds: 1500,
      joinCode: 'ABC123',
      endedAt: null,
    });
  });

  it('släpper inte ut delningens tokenhash', () => {
    expect(toMatch(matchRow)).not.toHaveProperty('joinTokenHash');
    expect(Object.values(toMatch(matchRow))).not.toContain(matchRow.join_token_hash);
  });
});

describe('toParticipant', () => {
  it('översätter raden till domänens fältnamn', () => {
    expect(toParticipant(participantRow)).toMatchObject({
      matchId: 'match-1',
      role: 'coach',
      displayName: 'Ulf',
      lastSeenAt: createdAt,
    });
  });

  it('släpper inte ut deltagarens tokenhash', () => {
    expect(toParticipant(participantRow)).not.toHaveProperty('tokenHash');
    expect(Object.values(toParticipant(participantRow))).not.toContain(participantRow.token_hash);
  });
});

describe('toStoredMatchEvent', () => {
  it('tar med serverns seq och received_at, inte bara klientens fält', () => {
    const at = new Date('2026-09-20T10:05:00.000Z');
    const receivedAt = new Date('2026-09-20T10:05:01.000Z');
    const row: Selectable<MatchEventTable> = {
      id: 'row-1',
      match_id: 'match-1',
      event_id: 'client-generated-1',
      seq: 7,
      type: 'period.started',
      payload: { period: 1 },
      at,
      received_at: receivedAt,
      by_participant_id: null,
    };

    expect(toStoredMatchEvent(row)).toEqual({
      id: 'row-1',
      matchId: 'match-1',
      eventId: 'client-generated-1',
      seq: 7,
      type: 'period.started',
      payload: { period: 1 },
      at,
      receivedAt,
      byParticipantId: null,
    });
  });
});
