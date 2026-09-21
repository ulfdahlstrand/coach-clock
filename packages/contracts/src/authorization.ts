import { MATCH_EVENT_TYPES, type MatchEventType } from './events.js';

/** Roller som kan kopplas till en enhet som deltar i en match. */
export const PARTICIPANT_ROLES = ['owner', 'coach', 'referee', 'viewer'] as const;

export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

const refereeEventTypes = [
  'period_started',
  'period_ended',
  'clock_paused',
  'clock_resumed',
] as const satisfies readonly MatchEventType[];

/**
 * Säkerhetsregeln för skrivningar i matchloggen. Håll den ren och i contracts:
 * både API:t och framtida klienter ska kunna förklara exakt varför en handling
 * är eller inte är möjlig, utan att duplicera policy.
 *
 * `owner` har samma loggrättigheter som en coach. Ägarens ytterligare
 * rättigheter (avsluta match och ta bort deltagare) hör till egna endpoints och
 * är därför inte händelsetyper i den här mappningen.
 */
export const allowedEventTypesByRole = {
  owner: MATCH_EVENT_TYPES,
  coach: MATCH_EVENT_TYPES,
  referee: refereeEventTypes,
  viewer: [],
} as const satisfies Readonly<Record<ParticipantRole, readonly MatchEventType[]>>;

/** Returnerar om rollen får lägga till just den här typen av matchhändelse. */
export function canAppendMatchEvent(role: ParticipantRole, eventType: MatchEventType): boolean {
  return (allowedEventTypesByRole[role] as readonly MatchEventType[]).includes(eventType);
}
