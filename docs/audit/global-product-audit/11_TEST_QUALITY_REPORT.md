# 11 — Rapport tests et qualité

> Phase 5. Distinction stricte : **RÉUSSI** (exécuté pendant l'audit, preuve datée), **ÉTAT DOCUMENTÉ** (réussi à une date
> antérieure selon la documentation, non rejoué), **NON EXÉCUTÉ**, **INEXISTANT**.

## 1. Inventaire et résultat

| Id | Type | Outil | Volume | Statut dans cet audit | Preuve |
|---|---|---|---|---|---|
| T-01 | Unitaires front (logique, hooks, écrans) | Vitest + jsdom | 133 fichiers | **RÉUSSI** en CI le 26/11 (tous verts après correction de configuration) | EV-05, EV-11 |
| T-02 | Unitaires Java | JUnit, ArchUnit | 8 classes, 35 tests | **RÉUSSI** en CI | EV-11 |
| T-03 | Intégration base + API (RLS réelle, PostgreSQL 18.6) | JUnit + Testcontainers | 100 classes, 299 tests | **RÉUSSI** en CI le 26/11 (12 tests corrigés, voir EV-06/EV-08) | EV-11 |
| T-04 | Contrat API | `OpenApiContractIT`, `npm run api:check` | 1 + 1 | **RÉUSSI** en CI | EV-11 |
| T-05 | Synchronisation des migrations nuage / sur site | `db:check-twins` | 138 paires | **RÉUSSI** en CI | EV-11 |
| T-06 | Statique | ESLint (0 erreur), `tsc` ×2 | — | **RÉUSSI** en CI | EV-11 |
| T-07 | E2E simulés (backend factice) | Playwright | 40 specs | NON EXÉCUTÉ (dernier état documenté 13/11 : 23 réussis, 17 ignorés) | CLAUDE.md |
| T-08 | Parcours métier nuage (écrivent dans la société de test) | Playwright | 32 specs | ÉTAT DOCUMENTÉ (vert à leur date de livraison respective) | CLAUDE.md, `docs/audit-erp/*` |
| T-09 | Parcours sur site (front → API Java → PostgreSQL) | Playwright | 46 tests annoncés | ÉTAT DOCUMENTÉ (19/11) | CLAUDE.md |
| T-10 | Régression du socle (dump → migrations → manifeste) | `verify-lot0.sh` | 1 | NON EXÉCUTÉ (exige le dump de production) | — |
| T-11 | Multi-société / isolation | `IsolationSocietesIT`, `TenantIsolationIT`, `ApiSecurityIT`, `SocieteDuProfilIT` | 4 classes | **RÉUSSI** (dans T-03) | EV-11 |
| T-12 | Permissions et séparation des tâches | `AuthorizationsApiIT`, `RolesDesModulesIT`, `ModuleAccessIT`, cycles de vie | ≥ 10 classes | **RÉUSSI** (dans T-03) | EV-11 |
| T-13 | Import (plan, budget, RH, relevés) | ITs dédiés | 4+ | **RÉUSSI** (dans T-03) | EV-11 |
| T-14 | Concurrence / idempotence | Partiel (inventaires, services, piste d'audit) | — | Partiel ; matrice transverse inexistante (G-41) | — |
| T-15 | Performance / charge / volumétrie | — | 0 | **INEXISTANT** | — |
| T-16 | Sécurité dynamique (pentest, DAST) | — | 0 | **INEXISTANT** | — |
| T-17 | Accessibilité automatisée (axe) | — | 0 | **INEXISTANT** | — |
| T-18 | Sauvegarde / restauration d'une instance client | — | 0 | **INEXISTANT** | — |
| T-19 | Recette utilisateur (UAT) signée | — | 0 récente | **INEXISTANT** (recettes lots 1–2 anciennes, avec réserves) | `docs/recette-lot*.md` |

## 2. Anomalies constatées pendant l'audit

| Id | Anomalie | Statut |
|---|---|---|
| AN-01 | CI « Client web » rouge sur `main` depuis le 20/11 (tests dépendants d'un `.env` absent en CI) | Corrigé (`6258b5e`) |
| AN-02 | 12 tests d'intégration contredits par le contrôle d'accès aux modules | Corrigé (`7392c6c`), effet produit à arbitrer (AUD-01) |
| AN-03 | `main` mergeable seulement après la PR #1 : la branche principale n'a pas eu de CI verte depuis 6 jours | Ouvert (fusion de la PR #1) |

## 3. Appréciation

Point fort du projet : **les règles métier sont testées contre une vraie base avec la vraie RLS**, sans simulation, et
chaque migration ajoute son test. Faiblesses : la CI de `main` est restée rouge 6 jours sans blocage (pas de protection de
branche), les parcours de bout en bout ne tournent pas en CI (ils exigent des comptes réels), et il n'existe ni test de
performance, ni test de restauration, ni recette utilisateur récente.

Recommandations : protection de branche exigeant la CI verte ; exécution nocturne des parcours sur une société de test
dédiée ; jeu de données volumineux et mesures de temps de réponse ; test de restauration automatisé ; campagne UAT par
module avec procès-verbal.
