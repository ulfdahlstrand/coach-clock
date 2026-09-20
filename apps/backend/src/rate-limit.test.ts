import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter } from './rate-limit.js';

describe('FixedWindowRateLimiter', () => {
  it('stoppar anrop över kvoten och öppnar igen i nästa fönster', () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({
      maxRequests: 2,
      windowMs: 1_000,
      now: () => now,
    });

    expect(limiter.consume('enhet:match')).toBe(true);
    expect(limiter.consume('enhet:match')).toBe(true);
    expect(limiter.consume('enhet:match')).toBe(false);

    now += 1_000;
    expect(limiter.consume('enhet:match')).toBe(true);
  });

  it('räknar olika nycklar var för sig', () => {
    const limiter = new FixedWindowRateLimiter({ maxRequests: 1, windowMs: 1_000 });

    expect(limiter.consume('första')).toBe(true);
    expect(limiter.consume('andra')).toBe(true);
  });
});
