import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { PHONE_MEDIA_QUERY, useIsPhone } from './use-is-phone';

function Probe() {
  return <output>{useIsPhone() ? 'phone' : 'desktop'}</output>;
}

afterEach(() => vi.unstubAllGlobals());

test('uses the 700px breakpoint and reacts to viewport changes', () => {
  let matches = false;
  let listener: (() => void) | undefined;
  const mediaQuery = {
    get matches() {
      return matches;
    },
    addEventListener: vi.fn((_type: string, callback: () => void) => {
      listener = callback;
    }),
    removeEventListener: vi.fn(),
  };
  const matchMedia = vi.fn((query: string) => {
    expect(query).toBe(PHONE_MEDIA_QUERY);
    return mediaQuery;
  });
  vi.stubGlobal('matchMedia', matchMedia);

  render(<Probe />);
  expect(screen.getByText('desktop')).toBeDefined();

  act(() => {
    matches = true;
    listener?.();
  });
  expect(screen.getByText('phone')).toBeDefined();
});
