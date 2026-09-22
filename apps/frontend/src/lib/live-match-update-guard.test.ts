import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveMatchUpdateGuard } from './live-match-update-guard';

afterEach(() => liveMatchUpdateGuard.setLive(false));

describe('live match update guard', () => {
  it('notifies when an update becomes safe to offer', () => {
    const listener = vi.fn();
    const unsubscribe = liveMatchUpdateGuard.subscribe(listener);
    liveMatchUpdateGuard.setLive(true);
    liveMatchUpdateGuard.setLive(false);
    unsubscribe();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(liveMatchUpdateGuard.isLive()).toBe(false);
  });
});
