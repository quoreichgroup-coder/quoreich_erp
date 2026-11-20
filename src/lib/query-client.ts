import { QueryClient, type InvalidateOptions, type InvalidateQueryFilters } from "@tanstack/react-query";

/**
 * Invalidation sans réponse périmée. Quand le PREMIER chargement d'une requête est encore en vol (pas encore de
 * données) au moment où une mutation l'invalide, TanStack Query ne relance pas : il rend la réponse en vol, lue avant
 * l'écriture. Observé dans le nuage (réseau plus lent) : une demande soumise n'affichait pas son niveau d'approbation, une
 * catégorie de retenue créée n'apparaissait pas. Ce premier chargement n'est PAS annulé (les invalidations du temps réel
 * arrivent en continu : annuler à chaque fois empêcherait une liste lente de jamais se charger) ; une seule relecture est
 * programmée à sa fin, donc postérieure à l'écriture.
 */
export class FreshQueryClient extends QueryClient {
  private readonly rereadScheduled = new WeakSet<object>();

  override invalidateQueries(filters?: InvalidateQueryFilters, options?: InvalidateOptions): Promise<void> {
    for (const q of this.getQueryCache().findAll(filters)) {
      if (q.state.fetchStatus !== "fetching" || q.state.data !== undefined || this.rereadScheduled.has(q)) continue;
      this.rereadScheduled.add(q);
      // fetch() sur une requête en vol rend la promesse en cours, sans nouvel appel réseau.
      void q.fetch().catch(() => undefined).finally(() => {
        this.rereadScheduled.delete(q);
        void super.invalidateQueries({ queryKey: q.queryKey, exact: true });
      });
    }
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