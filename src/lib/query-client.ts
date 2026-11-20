import { QueryClient, type InvalidateOptions, type InvalidateQueryFilters } from "@tanstack/react-query";

/**
 * Invalidation sans réponse périmée. Quand le PREMIER chargement d'une requête est encore en vol (pas encore de
 * données) au moment où une mutation l'invalide, TanStack Query ne relance pas : il rend la réponse en vol, lue avant
 * l'écriture. Observé dans le nuage (réseau plus lent) : une demande soumise n'affichait pas son niveau d'approbation, une
 * catégorie de retenue créée n'apparaissait pas. Ces premiers chargements sont annulés (état rétabli) avant
 * l'invalidation, qui relance alors une lecture postérieure à l'écriture. Les requêtes qui ont déjà des données sont
 * annulées et relancées par TanStack lui-même (cancelRefetch).
 */
export class FreshQueryClient extends QueryClient {
  override async invalidateQueries(filters?: InvalidateQueryFilters, options?: InvalidateOptions): Promise<void> {
    const inFlight = this.getQueryCache().findAll(filters)
      .filter((q) => q.state.fetchStatus === "fetching" && q.state.data === undefined);
    await Promise.all(inFlight.map((q) => q.cancel({ revert: true, silent: true })));
    return super.invalidateQueries(filters, options);
  }
}

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
export const queryClient = new FreshQueryClient({
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