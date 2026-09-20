import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import './i18n';
import './styles/globals.css';
import { createAppRouter } from './router';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Hittade inget element med id "root" i index.html.');
}

const router = createAppRouter();

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
