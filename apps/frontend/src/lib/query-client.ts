import { QueryClient } from '@tanstack/react-query';

/**
 * Appen körs på mobildata vid sidlinjen: 30 sekunders staleTime räcker för att
 * slippa refetch varje gång vyn får fokus, och ett enda omförsök gör att en
 * tillfällig lucka i täckningen inte blir ett synligt fel.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  });
}

export const queryClient = createQueryClient();
