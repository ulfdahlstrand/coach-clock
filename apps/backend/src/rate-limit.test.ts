import { describe, expect, it } from 'vitest';
import { ExponentialBackoffRateLimiter, FixedWindowRateLimiter } from './rate-limit.js';

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

describe('ExponentialBackoffRateLimiter', () => {
  it('spärrar både IP och kod och fördubblar spärrtiden vid upprepade fel', () => {
    let now = 0;
    const limiter = new ExponentialBackoffRateLimiter({
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      now: () => now,
    });

    expect(limiter.isAllowed('127.0.0.1', 'ABC123')).toBe(true);
    limiter.recordFailure('127.0.0.1', 'ABC123');
    expect(limiter.isAllowed('127.0.0.1', 'ABC123')).toBe(false);
    expect(limiter.isAllowed('127.0.0.2', 'ABC123')).toBe(false);
    expect(limiter.isAllowed('127.0.0.1', 'ZZZ999')).toBe(false);

    now = 100;
    expect(limiter.isAllowed('127.0.0.1', 'ABC123')).toBe(true);
    limiter.recordFailure('127.0.0.1', 'ABC123');
    now = 299;
    expect(limiter.isAllowed('127.0.0.1', 'ABC123')).toBe(false);
    now = 300;
    expect(limiter.isAllowed('127.0.0.1', 'ABC123')).toBe(true);
  });

  it('nollställer spärren efter en giltig anslutning', () => {
    const limiter = new ExponentialBackoffRateLimiter({ baseDelayMs: 100, maxDelayMs: 1_000 });
    limiter.recordFailure('127.0.0.1', 'ABC123');
    limiter.clear('127.0.0.1', 'ABC123');
    expect(limiter.isAllowed('127.0.0.1', 'ABC123')).toBe(true);
  });
});
