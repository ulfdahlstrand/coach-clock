import { queryOptions, useQuery } from '@tanstack/react-query';
import type { ServerTime } from '@coach-clock/contracts';
import { apiClient } from './api-client';

const defaultSampleCount = 5;

export interface ServerClockSample {
  readonly offsetMs: number;
  readonly roundTripMs: number;
}

export interface ServerClock {
  /** Serverns tid minus klientens tid, i millisekunder. */
  readonly offsetMs: number;
  readonly fastestRoundTripMs: number;
  readonly sampleCount: number;
  /** Skapar alltid en tidstämpel i serverns tidsdomän. */
  now(): Date;
  nowIso(): string;
}

export interface MeasureServerClockOptions {
  readonly now?: () => number;
  readonly sampleCount?: number;
}

/**
 * Mäter flera turer till /time och behåller den med kortast RTT. Den mätningen
 * har minst sannolik kötid och ger därför den mest användbara klockoffseten.
 */
export async function measureServerClock(
  getServerTime: () => Promise<ServerTime>,
  { now = Date.now, sampleCount = defaultSampleCount }: MeasureServerClockOptions = {},
): Promise<ServerClock> {
  if (!Number.isInteger(sampleCount) || sampleCount < 1) {
    throw new RangeError('sampleCount måste vara ett positivt heltal.');
  }

  const samples: ServerClockSample[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    const sentAt = now();
    const response = await getServerTime();
    const receivedAt = now();
    const roundTripMs = receivedAt - sentAt;
    const serverNow = Date.parse(response.now);

    if (!Number.isFinite(serverNow) || roundTripMs < 0) {
      throw new Error('Servern skickade en ogiltig tidstämpel.');
    }

    samples.push({
      roundTripMs,
      offsetMs: serverNow - (sentAt + roundTripMs / 2),
    });
  }

  const fastest = samples.reduce((current, sample) =>
    sample.roundTripMs < current.roundTripMs ? sample : current,
  );

  return {
    offsetMs: fastest.offsetMs,
    fastestRoundTripMs: fastest.roundTripMs,
    sampleCount: samples.length,
    now: () => new Date(now() + fastest.offsetMs),
    nowIso: () => new Date(now() + fastest.offsetMs).toISOString(),
  };
}

export const serverTimeQueryOptions = () =>
  queryOptions({
    queryKey: ['server-time'],
    queryFn: () => measureServerClock(() => apiClient.time()),
  });

/** Använd den här hooken när en händelse behöver en tidstämpel i serverns domän. */
export function useServerTime() {
  return useQuery(serverTimeQueryOptions());
}
