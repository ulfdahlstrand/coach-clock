import { describe, expect, it } from 'vitest';
import { becameSubstitutionDue, fairnessTileClass, formatNextSubstitution } from './fairness-ui';

describe('fairness live UI helpers', () => {
  it('uses increasingly warm player tiles as a player falls behind', () => {
    expect(fairnessTileClass(-1, 90_000)).toContain('sky');
    expect(fairnessTileClass(45_000, 90_000)).toContain('amber');
    expect(fairnessTileClass(90_000, 90_000)).toContain('rose');
  });

  it('only alerts when a simulated match crosses the configured threshold', () => {
    expect(becameSubstitutionDue(false, false)).toBe(false);
    expect(becameSubstitutionDue(false, true)).toBe(true);
    expect(becameSubstitutionDue(true, true)).toBe(false);
  });

  it('formats a countdown until the next fair substitution', () => {
    expect(formatNextSubstitution(61_001)).toBe('1:02');
    expect(formatNextSubstitution(null)).toBe('—');
  });
});
