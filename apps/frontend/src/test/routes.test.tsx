import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import '@/i18n';
import { routeTree } from '@/route-tree.gen';

/** Monterar det genererade route-trädet på en given adress, utan webbläsarhistorik. */
async function renderAt(path: string) {
  cleanup();
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

test('okänd adress ger notFound-vyn', async () => {
  await renderAt('/finns-inte');

  expect(screen.getByRole('heading').textContent).toBe('Sidan finns inte');
});

test('navigationen är översatt till svenska', async () => {
  await renderAt('/');

  expect(screen.getByRole('link', { name: 'Start' })).toBeDefined();
  expect(screen.getByRole('link', { name: 'Om appen' })).toBeDefined();
});
