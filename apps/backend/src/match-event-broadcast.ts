import type { SequencedMatchEvent } from '@coach-clock/contracts';

export type MatchEventListener = (event: SequencedMatchEvent) => void;

export interface MatchEventBroadcast {
  publish(event: SequencedMatchEvent): void;
  subscribe(matchId: string, listener: MatchEventListener): () => void;
}

/**
 * Processlokalt broadcast-register. Flera serverinstanser kräver pub/sub och
 * ligger uttryckligen utanför den här implementationens omfattning.
 */
export class InProcessMatchEventBroadcast implements MatchEventBroadcast {
  readonly #listeners = new Map<string, Set<MatchEventListener>>();

  publish(event: SequencedMatchEvent): void {
    const listeners = this.#listeners.get(event.event.matchId);
    if (listeners === undefined) return;

    for (const listener of [...listeners]) listener(event);
  }

  subscribe(matchId: string, listener: MatchEventListener): () => void {
    const listeners = this.#listeners.get(matchId) ?? new Set<MatchEventListener>();
    listeners.add(listener);
    this.#listeners.set(matchId, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(matchId);
    };
  }
}
