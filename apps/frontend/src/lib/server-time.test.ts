import { describe, expect, test } from 'vitest';
import { measureServerClock } from './server-time';

describe('measureServerClock', () => {
  test('uses the offset from the lowest round-trip sample', async () => {
    let currentTime = 1_000;
    const durations = [80, 20, 50];
    let requestIndex = 0;
    const now = () => currentTime;

    const clock = await measureServerClock(
      () => {
        const duration = durations[requestIndex] ?? 0;
        requestIndex += 1;
        currentTime += duration / 2;
        const response = { now: new Date(currentTime + 500).toISOString() };
        currentTime += duration / 2;
        return Promise.resolve(response);
      },
      { now, sampleCount: 3 },
    );

    expect(clock.fastestRoundTripMs).toBe(20);
    expect(clock.offsetMs).toBe(500);
    expect(clock.sampleCount).toBe(3);
  });

  test('emits timestamps in the server time domain', async () => {
    let currentTime = 10_000;
    const clock = await measureServerClock(
      () => {
        currentTime += 5;
        const response = { now: new Date(currentTime + 2_000).toISOString() };
        currentTime += 5;
        return Promise.resolve(response);
      },
      { now: () => currentTime, sampleCount: 1 },
    );

    currentTime = 20_000;
    expect(clock.nowIso()).toBe(new Date(22_000).toISOString());
  });

  test('rejects invalid sample counts', async () => {
    await expect(
      measureServerClock(() => Promise.resolve({ now: new Date().toISOString() }), {
        sampleCount: 0,
      }),
    ).rejects.toThrow('sampleCount måste vara ett positivt heltal.');
  });
});
