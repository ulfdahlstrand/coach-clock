export interface RateLimiter {
  /** Returnerar false när nyckeln redan har förbrukat sin kvot. */
  consume(key: string): boolean;
}

export interface FixedWindowRateLimiterOptions {
  readonly maxRequests: number;
  readonly windowMs: number;
  readonly now?: () => number;
}

type Window = { count: number; startedAt: number };

/**
 * Liten processlokal spärr för append-endpointen. Den skyddar en enskild
 * API-instans; en distribuerad limiter kan implementera samma interface senare.
 */
export class FixedWindowRateLimiter implements RateLimiter {
  readonly #windows = new Map<string, Window>();
  readonly #maxRequests: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  #lastSweep = 0;

  constructor(options: FixedWindowRateLimiterOptions) {
    if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1) {
      throw new Error('maxRequests måste vara ett positivt heltal');
    }
    if (!Number.isFinite(options.windowMs) || options.windowMs <= 0) {
      throw new Error('windowMs måste vara större än noll');
    }

    this.#maxRequests = options.maxRequests;
    this.#windowMs = options.windowMs;
    this.#now = options.now ?? Date.now;
  }

  consume(key: string): boolean {
    const now = this.#now();

    // Unika klient/match-par ska inte ligga kvar för evigt i en långlivad
    // process. En opportunistisk sweep kräver varken timer eller shutdown-hook.
    if (now - this.#lastSweep >= this.#windowMs) {
      for (const [storedKey, window] of this.#windows) {
        if (now - window.startedAt >= this.#windowMs) {
          this.#windows.delete(storedKey);
        }
      }
      this.#lastSweep = now;
    }

    const current = this.#windows.get(key);

    if (current === undefined || now - current.startedAt >= this.#windowMs) {
      this.#windows.set(key, { count: 1, startedAt: now });
      return true;
    }

    if (current.count >= this.#maxRequests) {
      return false;
    }

    current.count += 1;
    return true;
  }
}

export const defaultAppendRateLimiter = new FixedWindowRateLimiter({
  maxRequests: 120,
  windowMs: 60_000,
});

export interface JoinRateLimiter {
  isAllowed(ip: string, code: string): boolean;
  recordFailure(ip: string, code: string): void;
  clear(ip: string, code: string): void;
}

export interface ExponentialBackoffRateLimiterOptions {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly now?: () => number;
}

type Backoff = { failures: number; blockedUntil: number };

/**
 * Korta koder är medvetet lätta att skriva, men också möjliga att gissa.
 * Misslyckade försök spärras därför både per avsändar-IP och per kod. Fördröjningen
 * dubblas vid varje försök och begränsas av maxDelayMs.
 */
export class ExponentialBackoffRateLimiter implements JoinRateLimiter {
  readonly #backoffs = new Map<string, Backoff>();
  readonly #baseDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #now: () => number;

  constructor(options: ExponentialBackoffRateLimiterOptions) {
    if (!Number.isFinite(options.baseDelayMs) || options.baseDelayMs <= 0) {
      throw new Error('baseDelayMs måste vara större än noll');
    }
    if (!Number.isFinite(options.maxDelayMs) || options.maxDelayMs < options.baseDelayMs) {
      throw new Error('maxDelayMs måste vara minst baseDelayMs');
    }
    this.#baseDelayMs = options.baseDelayMs;
    this.#maxDelayMs = options.maxDelayMs;
    this.#now = options.now ?? Date.now;
  }

  isAllowed(ip: string, code: string): boolean {
    const now = this.#now();
    return this.#isKeyAllowed(`ip:${ip}`, now) && this.#isKeyAllowed(`code:${code}`, now);
  }

  recordFailure(ip: string, code: string): void {
    const now = this.#now();
    this.#record(`ip:${ip}`, now);
    this.#record(`code:${code}`, now);
  }

  clear(ip: string, code: string): void {
    this.#backoffs.delete(`ip:${ip}`);
    this.#backoffs.delete(`code:${code}`);
  }

  #isKeyAllowed(key: string, now: number): boolean {
    return (this.#backoffs.get(key)?.blockedUntil ?? 0) <= now;
  }

  #record(key: string, now: number): void {
    const previous = this.#backoffs.get(key);
    const failures = (previous?.failures ?? 0) + 1;
    const delay = Math.min(this.#baseDelayMs * 2 ** (failures - 1), this.#maxDelayMs);
    this.#backoffs.set(key, { failures, blockedUntil: now + delay });
  }
}

export const defaultJoinRateLimiter = new ExponentialBackoffRateLimiter({
  baseDelayMs: 1_000,
  maxDelayMs: 60 * 60_000,
});
