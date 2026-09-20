import type { ColumnType, Generated, Selectable } from 'kysely';

/**
 * Handskrivna tabelltyper — ingen kodgenerering.
 *
 * Konventionen är att databasen får behålla sitt snake_case hela vägen in i
 * `Database`-interfacet, och att varje tabell har en `toX(row)`-funktion som
 * översätter till camelCase för resten av koden. Översättningen sker på ett
 * ställe, så ingen rad snake_case läcker ut i domänen:
 *
 * ```ts
 * export interface TeamTable {
 *   id: Generated<string>;
 *   name: string;
 *   created_at: Generated<Date>;
 * }
 *
 * export interface Team {
 *   id: string;
 *   name: string;
 *   createdAt: Date;
 * }
 *
 * export function toTeam(row: Selectable<TeamTable>): Team {
 *   return { id: row.id, name: row.name, createdAt: row.created_at };
 * }
 * ```
 *
 * `toX` är också gränsen där hemligheter stannar: tokenhasharna finns i
 * tabelltyperna men aldrig i domäntyperna, så de kan inte råka följa med ut i
 * ett svar.
 */

/** Spelformerna i svensk ungdomsfotboll. Speglar checken på `matches.format`. */
export type MatchFormat = 5 | 7 | 9 | 11;

/**
 * Matchens livscykel. Klockan hör inte hit — om matchen rullar just nu avgörs
 * av händelseloggen, inte av en kolumn.
 */
export type MatchStatus = 'scheduled' | 'live' | 'ended';

/** Vad en enhet som gått med i en match får göra. Behörigheterna hör till #17. */
export type ParticipantRole = 'owner' | 'coach' | 'referee' | 'viewer';

/**
 * `jsonb`. Nyttolasten valideras mot händelseschemat i kontraktet innan den
 * används — databasen lovar bara att det är ett objekt.
 */
export type JsonObject = Record<string, unknown>;

export interface TeamTable {
  id: Generated<string>;
  name: string;
  created_at: Generated<Date>;
}

export interface Team {
  id: string;
  name: string;
  createdAt: Date;
}

export function toTeam(row: Selectable<TeamTable>): Team {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}

export interface PlayerTable {
  id: Generated<string>;
  team_id: string;
  name: string;
  /** Tröjnummer är frivilligt. */
  number: number | null;
  is_goalkeeper: Generated<boolean>;
  archived: Generated<boolean>;
}

export interface Player {
  id: string;
  teamId: string;
  name: string;
  number: number | null;
  isGoalkeeper: boolean;
  archived: boolean;
}

export function toPlayer(row: Selectable<PlayerTable>): Player {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    number: row.number,
    isGoalkeeper: row.is_goalkeeper,
    archived: row.archived,
  };
}

export interface MatchTable {
  id: Generated<string>;
  team_id: string;
  opponent: string;
  format: MatchFormat;
  formation_id: string;
  period_count: number;
  period_length_seconds: number;
  status: Generated<MatchStatus>;
  /** Kort kod att skriva in. Null tills matchen delas (#16). */
  join_code: string | null;
  /** sha256 i hex av delningstoken. Klartexttoken lagras aldrig. */
  join_token_hash: string | null;
  created_at: Generated<Date>;
  ended_at: Date | null;
}

/** Notera: `joinTokenHash` följer medvetet inte med ut ur db-lagret. */
export interface Match {
  id: string;
  teamId: string;
  opponent: string;
  format: MatchFormat;
  formationId: string;
  periodCount: number;
  periodLengthSeconds: number;
  status: MatchStatus;
  joinCode: string | null;
  createdAt: Date;
  endedAt: Date | null;
}

export function toMatch(row: Selectable<MatchTable>): Match {
  return {
    id: row.id,
    teamId: row.team_id,
    opponent: row.opponent,
    format: row.format,
    formationId: row.formation_id,
    periodCount: row.period_count,
    periodLengthSeconds: row.period_length_seconds,
    status: row.status,
    joinCode: row.join_code,
    createdAt: row.created_at,
    endedAt: row.ended_at,
  };
}

export interface ParticipantTable {
  id: Generated<string>;
  match_id: string;
  role: ParticipantRole;
  display_name: string;
  /** sha256 i hex av deltagarens token. Klartexttoken lagras aldrig. */
  token_hash: string;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
}

/** Notera: `tokenHash` följer medvetet inte med ut ur db-lagret. */
export interface Participant {
  id: string;
  matchId: string;
  role: ParticipantRole;
  displayName: string;
  createdAt: Date;
  lastSeenAt: Date;
}

export function toParticipant(row: Selectable<ParticipantTable>): Participant {
  return {
    id: row.id,
    matchId: row.match_id,
    role: row.role,
    displayName: row.display_name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export interface MatchEventTable {
  id: Generated<string>;
  match_id: string;
  /** Klientens id för händelsen — idempotensnyckeln tillsammans med `match_id`. */
  event_id: string;
  /** Serverns ordningsnummer, monotont per match. Foldens ordning. */
  seq: number;
  type: string;
  payload: ColumnType<JsonObject, JsonObject | string, JsonObject | string>;
  /** När händelsen inträffade enligt klienten. */
  at: Date;
  /** När servern tog emot den. */
  received_at: Generated<Date>;
  by_participant_id: string | null;
}

/**
 * Den lagrade raden, inte händelsen på tråden: `seq` och `receivedAt` sätts av
 * servern och finns inte i det klienten skickade in.
 */
export interface StoredMatchEvent {
  id: string;
  matchId: string;
  eventId: string;
  seq: number;
  type: string;
  payload: JsonObject;
  at: Date;
  receivedAt: Date;
  byParticipantId: string | null;
}

export function toStoredMatchEvent(row: Selectable<MatchEventTable>): StoredMatchEvent {
  return {
    id: row.id,
    matchId: row.match_id,
    eventId: row.event_id,
    seq: row.seq,
    type: row.type,
    payload: row.payload,
    at: row.at,
    receivedAt: row.received_at,
    byParticipantId: row.by_participant_id,
  };
}

export interface Database {
  teams: TeamTable;
  players: PlayerTable;
  matches: MatchTable;
  participants: ParticipantTable;
  match_events: MatchEventTable;
}
