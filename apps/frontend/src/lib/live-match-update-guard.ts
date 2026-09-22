type Listener = () => void;

let liveMatchRunning = false;
const listeners = new Set<Listener>();

/** A waiting service worker must never interrupt an active match clock. */
export const liveMatchUpdateGuard = {
  isLive: () => liveMatchRunning,
  setLive(isLive: boolean) {
    if (liveMatchRunning === isLive) return;
    liveMatchRunning = isLive;
    for (const listener of listeners) listener();
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
