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

test('/matches/$matchId/summary renderar en delningsbar matchsammantällning', async () => {
  await renderAt('/matches/00000000-0000-4000-8000-000000000001/summary');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Matchsammanfattning');
});

test('/join/$token visar den telefonanpassade join-skärmen', async () => {
  await renderAt('/join/K7M2QX');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Gå med vid sidlinjen');
  expect(screen.getByRole('button', { name: 'Gå med i matchen' })).toBeDefined();
});

test('/matches/$matchId/share visar kod och deltagarlistan', async () => {
  await renderAt('/matches/00000000-0000-4000-8000-000000000001/share');
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Bjud in en medtränare');
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
