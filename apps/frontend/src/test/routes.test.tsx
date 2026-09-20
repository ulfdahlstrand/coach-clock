import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import '@/i18n';
import { routeTree } from '@/route-tree.gen';

/** Monterar det genererade route-trädet på en given adress, utan webbläsarhistorik. */
async function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });

  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByRole('heading')).toBeDefined());
}

test('startsidan renderas på /', async () => {
  await renderAt('/');

  expect(screen.getByRole('heading').textContent).toBe('Matchklockan är redo');
});

test('/om renderas från route-trädet', async () => {
  await renderAt('/om');

  expect(screen.getByRole('heading').textContent).toBe('Om appen');
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
