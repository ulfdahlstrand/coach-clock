import { expect, test } from 'vitest';
import { googleSignInUrl, safeReturnTo } from './auth';

test('safeReturnTo godtar bara sökvägar i appen', () => {
  expect(safeReturnTo('/lag')).toBe('/lag');
  expect(safeReturnTo('//ond.se')).toBe('/');
  expect(safeReturnTo('/\\ond.se')).toBe('/');
  expect(safeReturnTo('https://ond.se')).toBe('/');
  expect(safeReturnTo(undefined)).toBe('/');
});

test('googleSignInUrl pekar på API:ts inloggning och bär med målet', () => {
  const url = new URL(googleSignInUrl('/matches/new'));
  expect(url.pathname).toMatch(/\/auth\/google$/);
  expect(url.searchParams.get('returnTo')).toBe('/matches/new');
});
