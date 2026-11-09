import { QueryClient } from "@tanstack/react-query";

/**
 * Client React Query partagé.
 *
 * Il vit dans son propre module (et non dans `App.tsx`) pour que `AuthContext`
 * puisse vider le cache à la déconnexion : les clés de requête sont portées par
 * le tenant (`["tenant-id"]`, `["bank-accounts", tenantId]`, ...), donc un cache
 * survivant à la déconnexion ferait fuiter les données d'un compte vers le
 * suivant sur le même navigateur.
 *
 * Les options sont désormais explicites. Les hooks CFO
 * (`use-consolidated-cfo.ts`, `use-consolidated-trends.ts`) conservent leur
 * `retry: false` : une erreur de consolidation doit être visible, pas réessayée.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Comportement historique de `new QueryClient()`, rendu explicite.
      retry: 3,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      // Les données sont déjà rafraîchies par `useRealtimeInvalidation` :
      // refetcher à chaque retour d'onglet ne fait qu'ajouter du bruit réseau.
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});