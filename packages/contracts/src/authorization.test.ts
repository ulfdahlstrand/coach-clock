import { describe, expect, it } from 'vitest';
import {
  allowedEventTypesByRole,
  canAppendMatchEvent,
  MATCH_EVENT_TYPES,
  PARTICIPANT_ROLES,
} from './index.js';

describe('behörighet för matchhändelser', () => {
  it('ger coach och owner tillgång till alla kända händelser', () => {
    expect(allowedEventTypesByRole.coach).toEqual(MATCH_EVENT_TYPES);
    expect(allowedEventTypesByRole.owner).toEqual(MATCH_EVENT_TYPES);
  });

  it('begränsar referee till klock- och periodhändelser', () => {
    expect(allowedEventTypesByRole.referee).toEqual([
      'period_started',
      'period_ended',
      'clock_paused',
      'clock_resumed',
    ]);
    expect(canAppendMatchEvent('referee', 'substitution_confirmed')).toBe(false);
  });

  it('ger viewer ingen skrivrättighet', () => {
    expect(allowedEventTypesByRole.viewer).toEqual([]);
    for (const eventType of MATCH_EVENT_TYPES) {
      expect(canAppendMatchEvent('viewer', eventType)).toBe(false);
    }
  });

  it('har en komplett regel för varje deltagarroll', () => {
    expect(Object.keys(allowedEventTypesByRole).sort()).toEqual([...PARTICIPANT_ROLES].sort());
  });
});
