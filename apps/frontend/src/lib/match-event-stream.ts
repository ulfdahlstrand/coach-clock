import type { SequencedMatchEvent } from '@coach-clock/contracts';
import { apiBaseUrl, apiClient } from './api-client';

export type MatchStreamStatus = 'connecting' | 'connected' | 'reconnecting' | 'paused' | 'stopped';

export interface EventSourceMessage {
  readonly data: string;
}

export interface EventSourceLike {
  close(): void;
  onopen: ((event?: Event) => void) | null;
  onmessage: ((message: EventSourceMessage) => void) | null;
  onerror: ((event?: Event) => void) | null;
}

export type EventSourceFactory = (
  url: string,
  options: { withCredentials: boolean },
) => EventSourceLike;

export interface VisibilitySource {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface MatchEventStreamOptions {
  readonly matchId: string;
  readonly onEvent: (event: SequencedMatchEvent) => void;
  readonly readEvents?: (sinceSeq: number) => Promise<readonly SequencedMatchEvent[]>;
  readonly eventSource?: EventSourceFactory;
  readonly visibility?: VisibilitySource;
  readonly onStatusChange?: (status: MatchStreamStatus) => void;
  readonly initialSeq?: number;
  readonly baseRetryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly setTimeout?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimeout?: (timer: unknown) => void;
}

export interface MatchEventStream {
  start(): void;
  stop(): void;
  catchUp(): Promise<void>;
  readonly lastSeq: number;
  readonly status: MatchStreamStatus;
}

const defaultBaseRetryDelayMs = 1_000;
const defaultMaxRetryDelayMs = 30_000;

function defaultEventSource(url: string, options: { withCredentials: boolean }): EventSourceLike {
  // The browser's DOM callback properties include an explicit `this` context;
  // our smaller test seam deliberately does not need to expose it.
  return new EventSource(url, options) as unknown as EventSourceLike;
}

function defaultVisibilitySource(): VisibilitySource | undefined {
  return typeof document === 'undefined' ? undefined : document;
}

function streamUrl(matchId: string): string {
  const url = new URL('/matches/stream', apiBaseUrl);
  url.searchParams.set('matchId', matchId);
  return url.toString();
}

/**
 * Keeps a local match log in the server's canonical sequence order. SSE is a
 * low-latency hint; the normal read endpoint is the source of truth whenever a
 * message is skipped, a connection is opened, or a background tab returns.
 */
export function createMatchEventStream(options: MatchEventStreamOptions): MatchEventStream {
  const {
    matchId,
    onEvent,
    readEvents = (sinceSeq) => apiClient.matches.listEvents({ matchId, sinceSeq }),
    eventSource = defaultEventSource,
    visibility = defaultVisibilitySource(),
    onStatusChange,
    initialSeq = 0,
    baseRetryDelayMs = defaultBaseRetryDelayMs,
    maxRetryDelayMs = defaultMaxRetryDelayMs,
    setTimeout: configuredTimeout,
    clearTimeout: configuredClearTimeout,
  } = options;
  const scheduleTimeout =
    configuredTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancelTimeout =
    configuredClearTimeout ??
    ((timer: unknown) => clearTimeout(timer as ReturnType<typeof globalThis.setTimeout>));

  if (!Number.isInteger(initialSeq) || initialSeq < 0) {
    throw new RangeError('initialSeq måste vara ett icke-negativt heltal.');
  }
  if (baseRetryDelayMs <= 0 || maxRetryDelayMs < baseRetryDelayMs) {
    throw new RangeError('Ogiltig reconnect-konfiguration.');
  }

  let lastSeq = initialSeq;
  let status: MatchStreamStatus = 'stopped';
  let source: EventSourceLike | undefined;
  let reconnectTimer: unknown;
  let retries = 0;
  let running = false;
  let operation = Promise.resolve();

  const setStatus = (next: MatchStreamStatus) => {
    if (status === next) return;
    status = next;
    onStatusChange?.(next);
  };

  const isVisible = () => visibility?.hidden !== true;
  const clearReconnect = () => {
    if (reconnectTimer !== undefined) {
      cancelTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  };
  const closeSource = () => {
    source?.close();
    source = undefined;
  };

  // Serialising both SSE and HTTP deliveries makes a gap deterministic even
  // when the stream races the catch-up request.
  const enqueue = (work: () => Promise<void>) => {
    operation = operation.then(work, work);
    return operation;
  };

  const merge = (events: readonly SequencedMatchEvent[]) => {
    for (const event of [...events].sort((left, right) => left.seq - right.seq)) {
      if (event.event.matchId !== matchId || event.seq <= lastSeq) continue;
      if (event.seq !== lastSeq + 1) return false;
      lastSeq = event.seq;
      onEvent(event);
    }
    return true;
  };

  const sync = async () => {
    // A server may return duplicates during a reconnect; merge filters them.
    // Re-read if the response itself exposed a hole (e.g. a concurrent append).
    for (;;) {
      const before = lastSeq;
      const received = await readEvents(lastSeq);
      const contiguous = merge(received);
      if (contiguous || lastSeq === before) return;
    }
  };

  const scheduleReconnect = () => {
    if (!running || !isVisible() || reconnectTimer !== undefined) return;
    closeSource();
    const exponent = Math.min(retries, 30);
    const delay = Math.min(maxRetryDelayMs, baseRetryDelayMs * 2 ** exponent);
    retries += 1;
    setStatus('reconnecting');
    reconnectTimer = scheduleTimeout(() => {
      reconnectTimer = undefined;
      open();
    }, delay);
  };

  const receive = (candidate: unknown) => {
    if (typeof candidate !== 'object' || candidate === null) return;
    const record = candidate as Record<string, unknown>;
    const seq = record['seq'];
    if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= lastSeq) return;
    const event = record as unknown as SequencedMatchEvent;
    enqueue(async () => {
      if (event.seq > lastSeq + 1) await sync();
      merge([event]);
      // The SSE message can still be ahead of an in-flight database read.
      // Leave it unapplied until a future replay proves the missing sequence.
    }).catch(scheduleReconnect);
  };

  const open = () => {
    if (!running || !isVisible() || source !== undefined) return;
    setStatus(retries === 0 ? 'connecting' : 'reconnecting');
    const next = eventSource(streamUrl(matchId), { withCredentials: true });
    source = next;
    next.onopen = () => {
      if (source !== next || !running) return;
      retries = 0;
      setStatus('connected');
      enqueue(sync).catch(scheduleReconnect);
    };
    next.onmessage = (message) => {
      if (source !== next || !running) return;
      try {
        receive(JSON.parse(message.data));
      } catch {
        // An invalid network frame is ignored; it must never corrupt the log.
      }
    };
    next.onerror = () => {
      if (source !== next || !running) return;
      scheduleReconnect();
    };
  };

  const onVisibilityChange = () => {
    if (!running) return;
    if (!isVisible()) {
      clearReconnect();
      closeSource();
      setStatus('paused');
      return;
    }
    enqueue(sync).then(open).catch(scheduleReconnect);
  };

  return {
    start() {
      if (running) return;
      running = true;
      visibility?.addEventListener('visibilitychange', onVisibilityChange);
      if (!isVisible()) {
        setStatus('paused');
        return;
      }
      open();
    },
    stop() {
      if (!running) return;
      running = false;
      clearReconnect();
      closeSource();
      visibility?.removeEventListener('visibilitychange', onVisibilityChange);
      setStatus('stopped');
    },
    catchUp() {
      return enqueue(sync);
    },
    get lastSeq() {
      return lastSeq;
    },
    get status() {
      return status;
    },
  };
}
