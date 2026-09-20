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
