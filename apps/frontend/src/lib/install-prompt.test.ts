import { expect, test } from 'vitest';
import {
  DISMISS_DURATION_MS,
  REQUIRED_VISITS_BEFORE_PROMPT,
  canShowInstallPrompt,
  dismissInstallPrompt,
  nextVisitCount,
} from './install-prompt';

test('requires a returning visitor and respects a dismissed prompt cooldown', () => {
  const storage = window.localStorage;
  storage.clear();
  const now = 1_000;

  expect(nextVisitCount(storage)).toBe(1);
  expect(nextVisitCount(storage)).toBe(REQUIRED_VISITS_BEFORE_PROMPT);
  expect(canShowInstallPrompt(storage, now)).toBe(true);

  dismissInstallPrompt(storage, now);
  expect(canShowInstallPrompt(storage, now + DISMISS_DURATION_MS - 1)).toBe(false);
  expect(canShowInstallPrompt(storage, now + DISMISS_DURATION_MS)).toBe(true);
});
