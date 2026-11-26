# 02 — Audit d'architecture

> Phase 3 de l'audit global. Constats issus du code au commit `7392c6c` ; preuves `EV-xx` dans `22_EVIDENCE_REGISTER.md`.

## 1. Vue d'ensemble

```
                 Navigateur (React 19 SPA, Vite 8, Tailwind 4, shadcn/ui)
                          │  supabase-js (même client dans les deux cibles)
          ┌───────────────┴────────────────┐
   Nuage  │                                │  Sur site
   Supabase : PostgREST + Auth + Realtime  │  API Java 25 / Spring Boot 4.1 (monolithe modulaire)
   + Storage + 8 fonctions edge (Deno)     │  /auth/v1 (GoTrue compatible), /api/v1/<module>, WebSocket
          │                                │  Gotenberg (PDF), tâches planifiées (IA, BCEAO, congés)
          └───────────────┬────────────────┘
          PostgreSQL 18.6 — même schéma (Flyway V1..V154 = migrations Supabase jumelles)
          Logique métier : 457 fonctions SECURITY DEFINER, 351 déclencheurs, 446 politiques RLS
```

**Choix structurant** : la base est le cœur métier. Les règles (équilibre, périodes, séparation des tâches, isolation des
sociétés, numérotation) sont dans PostgreSQL, donc identiques quel que soit le chemin d'accès (écran, API Java, import,
fonction edge). C'est ce qui rend la double cible (nuage / sur site) tenable.

## 2. Front-end

| Point | Constat | Appréciation |
|---|---|---|
| Structure | 114 pages paresseuses (`React.lazy`), un module de hooks par domaine, logique pure dans `src/lib` testée | Bonne |
| Navigation | Menu standard par module imposé par `navigation.test.ts` ; 116 routes vérifiées | Bonne |
| Double cible | Branches `isApiEnabled()` dans les hooks ; `moduleRpc` garde le contrat `{data, error}` de supabase-js | Fonctionnel mais **duplication** : chaque hook porte deux chemins de données |
| Types | `types.ts` Supabase généré mais non régénéré (contient `user_roles` supprimé) ; nombreux `(supabase as any)` (≈ 430 avertissements lint) | **Dette** : la frontière de types n'est pas fiable |
| Gardes de route | `ProtectedRoute` (connecté + société) ; accès aux modules filtré côté navigation et côté API ; la base reste la frontière | Correct |
| Internationalisation | Aucune ; tout le texte est en français en dur | Bloquant pour d'autres marchés (cadrage `docs/i18n/` non versionné) |
| Performance initiale | Premier écran 774 kB JS (227 kB gzip) mesuré le 9 nov. ; bibliothèques lourdes chargées à la demande | Correct |

## 3. API Java (sur site)

| Point | Constat |
|---|---|
| Découpage | Monolithe modulaire, frontières de paquets imposées par `ArchitectureTest` (ArchUnit) ; 34 contrôleurs |
| Accès aux données | `Sql` / `JdbcTemplate` : lectures en `to_jsonb` (même forme que PostgREST), écritures limitées aux colonnes permises, `tenant_id` posé par le serveur |
| Contexte société | `TenantAwareDataSource` pose `request.jwt.claims` par connexion ; la société vient de `profiles`, jamais du jeton |
| Garde de démarrage | `DatabaseSecurityGuard` refuse de démarrer si la connexion est superutilisateur, `BYPASSRLS`, propriétaire d'une table ou hors `authenticated` |
| Contrat | OpenAPI versionné, figé par `OpenApiContractIT`, types front générés et vérifiés en CI |
| Identité | GoTrue compatible : ES256, sessions vérifiées à chaque requête, rafraîchissement à usage unique, verrouillage après 5 échecs (V114–V115) |
| Erreurs | `DatabaseRefusalAdvice` : codes SQLSTATE métier → 422 avec message, 42501 → 403 |
| Observabilité | Actuator + Prometheus présents dans le POM ; **aucune supervision déployée** (pas d'environnement de production) |

## 4. Intégrations

Gotenberg (PDF/A, réseau interne), BCEAO (cours), webhook de suivi d'expéditions (format DCSA), SMTP (relances),
fournisseur IA compatible OpenAI (sur site) / Gemini via Lovable (nuage). Dans le nuage, `document-render` et `ar-dunning`
ne sont pas déployés et aucun hôte de rendu PDF n'est configuré (EV-14).

## 5. Risques d'architecture

| # | Risque | Gravité | Commentaire |
|---|---|---|---|
| A-1 | **Volume de logique en PL/pgSQL** (562 fonctions, 351 déclencheurs) | Moyenne | Testé par 100 classes d'intégration ; mais compétence rare à recruter, débogage et profilage plus difficiles ; ordre alphabétique des déclencheurs déjà source de pièges (V37, V30) |
| A-2 | **Double chemin de données dans le front** (Supabase / API Java) | Moyenne | Chaque évolution doit être écrite deux fois ; les parcours sur site le contrôlent mais le coût de maintenance est structurel |
| A-3 | **Deux migrations jumelles par changement** | Faible | Contrôlé automatiquement (`db:check-twins`) |
| A-4 | Types Supabase non régénérés | Moyenne | Les erreurs de colonnes ne sont vues qu'à l'exécution |
| A-5 | Pas d'environnement de production ni de préproduction | **Élevée** | Voir `12_DEVOPS_READINESS.md` |
| A-6 | Application monolingue | Moyenne | Bloque l'international |
| A-7 | Aucune base pour mobile / EAM / IA agentique | Élevée pour la vision 2030 | Voir 08, 09, 10 |
