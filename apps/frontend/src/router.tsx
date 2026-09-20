import { createRouter } from '@tanstack/react-router';
import { routeTree } from './route-tree.gen';

export function createAppRouter() {
  return createRouter({ routeTree });
}

// Gör Link/useNavigate typade mot det genererade route-trädet.
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
