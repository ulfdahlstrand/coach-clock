import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { InstallPrompt } from './install-prompt';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

test('does not interrupt a first visit, then offers installation to a return visitor', () => {
  render(<InstallPrompt />);
  expect(screen.queryByRole('button', { name: 'Installera' })).toBeNull();
  cleanup();

  render(<InstallPrompt />);
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.assign(event, {
    prompt: vi.fn(() => Promise.resolve()),
    userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
  });
  act(() => {
    window.dispatchEvent(event);
  });

  expect(event.defaultPrevented).toBe(true);
  expect(screen.getByRole('button', { name: 'Installera' })).toBeDefined();
});
