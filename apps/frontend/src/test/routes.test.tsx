import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { AuthUser } from '@coach-clock/contracts';
import '@/i18n';
import { meQueryKey } from '@/lib/auth';
import { queryClient } from '@/lib/query-client';
import { routeTree } from '@/route-tree.gen';

const coach: AuthUser = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Ulf',
  email: 'ulf@example.se',
  imageUrl: null,
};

/**
 * Monterar det genererade route-trädet på en given adress, utan webbläsarhistorik.
 * Som inloggad tränare om inget annat sägs — vakterna frågar annars servern.
 */
async function renderAt(path: string, user: AuthUser | null = coach) {
  cleanup();
  queryClient.clear();
  queryClient.setQueryData(meQueryKey, { user });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeDefined());
}

test('startsidan renderas på /', async () => {
  await renderAt('/');

  expect(screen.getByRole('heading').textContent).toBe('Matchklockan är redo');
});

test('/om renderas från route-trädet', async () => {
  await renderAt('/om');

  expect(screen.getByRole('heading').textContent).toBe('Om appen');
});

test('tränarens sidor skickar en utloggad besökare till inloggningen', async () => {
  for (const path of ['/lag', '/matches/new', '/lag/00000000-0000-4000-8000-000000000001']) {
    await renderAt(path, null);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Logga in');
    const google = screen.getByRole('link', { name: 'Logga in med Google' });
    expect(new URL(google.getAttribute('href') ?? '').searchParams.get('returnTo')).toBe(path);
  }
});

test('domarens och åskådarens vyer kräver ingen inloggning', async () => {
  await renderAt('/titta/K7M2QX', null);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Följ från sidlinjen');
});

test('/logga-in visar ett begripligt fel efter en misslyckad inloggning', async () => {
  await renderAt('/logga-in?error=failed', null);
  expect(screen.getByRole('alert').textContent).toBe('Inloggningen misslyckades. Försök igen.');
});

test('huvudet visar inloggning eller utloggning', async () => {
  await renderAt('/', null);
  expect(screen.getAllByRole('link', { name: 'Logga in' }).length).toBeGreaterThan(0);

  await renderAt('/');
  expect(screen.getByRole('button', { name: 'Logga ut' }).getAttribute('title')).toBe(
    'Inloggad som Ulf',
  );
});

test('/lag och truppvyn finns i route-trädet', async () => {
  await renderAt('/lag');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Dina lag');
});

test('/lag/$teamId renderar en telefonanpassad truppvy', async () => {
  await renderAt('/lag/00000000-0000-4000-8000-000000000001');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Trupp');
  expect(screen.getByRole('button', { name: 'Lägg till spelare' })).toBeDefined();
});

test('/matches/new renderar den telefonanpassade matchstarten', async () => {
  await renderAt('/matches/new');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ny match');
  expect(screen.getByRole('button', { name: 'Starta match' })).toBeDefined();
});

test('/matches/new har positionsläget förvalt till bara speltid', async () => {
  await renderAt('/matches/new');

  const mode = screen.getByRole<HTMLSelectElement>('combobox', {
    name: 'Positioner i bytesförslagen',
  });
  expect(mode.value).toBe('time');
  expect([...mode.options].map((option) => option.textContent)).toEqual([
    'Bara speltid',
    'Bästa positioner',
    'Jämn fördelning',
  ]);
});

test('/matches/new har bytestiden förvald till fyra minuter', async () => {
  await renderAt('/matches/new');

  const shift = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Bytestid' });
  expect(shift.value).toBe('240');
  expect([...shift.options].map((option) => option.textContent)).toEqual([
    '3 minuter',
    '4 minuter',
    '5 minuter',
    '6 minuter',
  ]);
});

test('/matches/$matchId/summary renderar en delningsbar matchsammantällning', async () => {
  await renderAt('/matches/00000000-0000-4000-8000-000000000001/summary');
  // Händelselistan med rättningar bor här sedan #90, inte i matchvyn.
  expect(screen.getByRole('heading', { name: 'Händelser' })).toBeDefined();
  expect(screen.getByRole('list', { name: 'Matchens händelser' })).toBeDefined();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Matchsammanfattning');
});

test('/join/$token visar den telefonanpassade join-skärmen', async () => {
  await renderAt('/join/K7M2QX');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Gå med vid sidlinjen');
  expect(screen.getByRole('button', { name: 'Gå med i matchen' })).toBeDefined();
});

test('/titta/$token visar en skrivskyddad föräldralänk', async () => {
  await renderAt('/titta/K7M2QX');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Följ från sidlinjen');
  expect(screen.getByRole('button', { name: 'Följ matchen' })).toBeDefined();
  expect(screen.queryByRole('button', { name: 'Pausa' })).toBeNull();
});

test('/domare/$token visar den begränsade domarvyn', async () => {
  await renderAt('/domare/K7M2QXrefereeToken123456');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Styr matchklockan');
  expect(screen.getByRole('button', { name: 'Öppna domarklockan' })).toBeDefined();
});

test('/matches/$matchId/share visar kod och deltagarlistan', async () => {
  await renderAt('/matches/00000000-0000-4000-8000-000000000001/share');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Bjud in föräldrar');
  expect(screen.getByLabelText('Anslutningskod')).toBeDefined();
  expect(screen.getByRole('list', { name: 'Deltagare i matchen' })).toBeDefined();
});

test('/matches/$matchId/share leder vidare in i matchen', async () => {
  await renderAt('/matches/00000000-0000-4000-8000-000000000001/share');

  // Matchen är igång när sidan visas; utan de här vägarna är den en återvändsgränd.
  const toMatch = screen.getAllByRole('link', { name: /Till matchen/ });
  expect(toMatch.length).toBe(2);
  for (const link of toMatch) {
    expect(link.getAttribute('href')).toBe('/matches/00000000-0000-4000-8000-000000000001');
  }
});

test('okänd adress ger notFound-vyn', async () => {
  await renderAt('/finns-inte');

  expect(screen.getByRole('heading').textContent).toBe('Sidan finns inte');
});

test('navigationen är översatt till svenska', async () => {
  await renderAt('/');

  expect(screen.getByRole('link', { name: 'Start' })).toBeDefined();
  expect(screen.getByRole('link', { name: 'Om appen' })).toBeDefined();
});
