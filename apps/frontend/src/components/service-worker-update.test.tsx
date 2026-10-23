import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ServiceWorkerUpdate } from './service-worker-update';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

function mockServiceWorker(waiting: { postMessage: () => void } | null) {
  const registration = Object.assign(new EventTarget(), { waiting, installing: null });
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      controller: {},
      register: vi.fn(() => Promise.resolve(registration)),
    }),
  });
}

test('stays hidden when no service worker is waiting', async () => {
  mockServiceWorker(null);
  await act(async () => {
    render(<ServiceWorkerUpdate />);
    await Promise.resolve();
  });

  expect(screen.queryByRole('button', { name: 'Ladda om' })).toBeNull();
});

test('offers a reload when a new service worker is waiting', async () => {
  const postMessage = vi.fn();
  mockServiceWorker({ postMessage });
  await act(async () => {
    render(<ServiceWorkerUpdate />);
    await Promise.resolve();
  });

  act(() => {
    screen.getByRole('button', { name: 'Ladda om' }).click();
  });
  expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
});
