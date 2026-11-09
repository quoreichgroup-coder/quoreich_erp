# Checklist tenant-scoping — Alertes & Notifications

Objectif : garantir qu'aucun chemin (lecture, écriture, RPC, Realtime) ne peut traverser les frontières tenant.

## 1. Tables couvertes
- `public.erp_alerts`
- `public.notification_preferences`

## 2. Garde-fous DB (à vérifier dans Supabase)
- [x] RLS activée sur `erp_alerts` et `notification_preferences`.
- [x] Toute policy SELECT/INSERT/UPDATE/DELETE filtre par `tenant_id = public.current_tenant_id()` (ou équivalent via `profiles`).
- [x] `tenant_id` est NOT NULL et défaut serveur (trigger `BEFORE INSERT` qui force `tenant_id := current_tenant_id()`).
- [x] RPCs `resolve_erp_alert`, `mark_all_erp_alerts_read`, `resolve_all_erp_alerts` :
  - `SECURITY DEFINER` + `SET search_path = public`.
  - Vérifient `tenant_id = current_tenant_id()` sur le `UPDATE`.
  - Ne retournent que des rows du tenant courant.
- [x] Aucune policy `USING (true)` ni `TO public` sur ces tables.

## 3. Couche client (`src/hooks/use-alerts-data.ts`)
- [x] `useERPAlerts` / `useERPAlertsPaginated` / `useUnreadAlertsCount` : pas de `tenant_id` côté client → s'appuient strictement sur RLS.
- [x] Aucun usage de `service_role` côté front (clé `anon` uniquement via `@/integrations/supabase/client`).
- [x] `useRealtimeAlerts` souscrit avec `filter: tenant_id=eq.${tenantId}` issu de `useTenantId()` (cf. test `use-realtime-alerts.test.ts`).
- [x] Cache React-Query : le cache entier est vidé à la déconnexion — `queryClient.clear()` appelé sur l'événement `SIGNED_OUT` dans `src/contexts/AuthContext.tsx`. L'événement, et non la fonction `signOut()`, couvre aussi l'expiration de session et la déconnexion depuis un autre onglet. Le client partagé est défini dans `src/lib/query-client.ts`.

## 4. Préférences (`use-notification-preferences.ts`)
- [x] `upsert` envoie `user_id = auth.user.id` ET `tenant_id` issu de `useTenantId()`.
- [x] PK composite `(user_id, tenant_id)` empêche le mélange entre tenants pour un même user multi-tenant.
- [x] Policy : `user_id = auth.uid() AND tenant_id = current_tenant_id()`.

## 5. Realtime
- [x] Channel nommé `erp-alerts-${tenantId}` → un canal par tenant.
- [x] Filtre serveur `tenant_id=eq.${tenantId}` (vérifié par test).
- [x] RLS s'applique aussi aux broadcasts Realtime (Supabase respecte la policy SELECT).

## 6. Cas à re-tester en cas de changement
1. Ajout d'un nouveau RPC sur `erp_alerts` → vérifier filtre `tenant_id`.
2. Ajout d'une vue/`security definer` qui SELECT `erp_alerts` → re-checker le `WHERE`.
3. Bascule d'un user entre tenants → invalider `["tenant-id"]` puis `["erp-alerts"]`.
4. Edge function qui écrit des alertes → toujours fournir `tenant_id` explicite (jamais auto-détecté côté serveur sans contexte JWT).

## 7. Tests automatisés en place
- `src/hooks/__tests__/use-alerts-data.test.ts` — pagination, tri, prefs whitelists, RPC bulk.
- `src/hooks/__tests__/use-realtime-alerts.test.ts` — filtre Realtime tenant-scopé + invalidation sur UPDATE.
- `tests/e2e/alerts-page.spec.ts` — E2E `/alerts` avec mocks REST/RPC tenant-scoped.
