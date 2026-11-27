# Équipe d'agents — mode de travail

Mis en place le 26 nov. 2026 à la demande du propriétaire : des agents développent chacun un module sur sa branche,
poussent sur GitHub et ouvrent une demande de fusion (PR) ; la session principale relit le code avant toute fusion,
comme dans une équipe.

## 1. Attribuer un module

Le propriétaire l'écrit en une ligne dans la conversation principale :

> **Agent `<nom>` : `<module ou référence du backlog>`** — `<précisions, priorité, interdits>`

Exemple : « Agent licences : AUD-06 autorité de licences — priorité haute, ne pas toucher aux paiements ».
Au plus **3 agents en même temps** (mémoire du poste).

## 2. Rôles

| Rôle | Fait | Ne fait jamais |
|---|---|---|
| Propriétaire | Attribue les modules, tranche les décisions métier, autorise la production | — |
| Session principale (relecteur) | Prépare l'agent (arbre de travail, branche, numéros de migration), relit, demande des corrections, fusionne, rebase les autres branches | Fusionner une PR rouge ou non relue |
| Agent | Références, plan, code, tests ciblés, PR, corrections | Fusionner, pousser sur `main`, toucher la production, réécrire l'historique d'une autre branche, modifier un fichier hors de son module sans le signaler |

## 3. Pipeline d'un module

| Étape | Qui | Livrable |
|---|---|---|
| 0. Préparation | Principal | Arbre de travail séparé (`.tmp_agent-<nom>`), branche `feat/<module>` depuis `main`, numéros réservés (§4) |
| 1. Références | Agent | Audit de l'existant puis comparaison SAP / Sage / OHADA ou norme utile, sources citées |
| 2. Plan | Agent | PR **brouillon** : périmètre, fichiers, migrations, tests, questions ouvertes |
| 3. Code | Agent | Migration Flyway + jumelle Supabase (même SQL), API Java, écrans, tests |
| 4. Tests locaux | Agent | **Ciblés** : Vitest des fichiers touchés, ITs du module, `tsc`, lint des fichiers touchés, `db:check-twins` ; les suites complètes tournent en CI |
| 5. Prête | Agent | PR passée en « prête », CI verte, case à cocher du modèle remplies |
| 6. Revue | Principal | Commentaires sur la PR (sécurité, isolation, droits, jumelles, tests, conventions) |
| 7. Corrections | Agent | Réponses aux commentaires, CI verte |
| 8. Fusion | Principal | Une PR à la fois, commit de fusion ; les autres branches se rebasent sur `main` |
| 9. Déploiement | Automatique / propriétaire | Recette automatique ; production à la demande avec validation |

## 4. Réservations (anti-collision)

| Ressource | Règle |
|---|---|
| Numéro Flyway `Vxxx` et horodatage de la jumelle Supabase | Attribués par la session principale à la préparation ; un agent n'en prend pas d'autre sans le demander |
| `SchemaMigrationIT` (`DERNIERE_MIGRATION`, déclarations), compteurs de `AuthorizationsApiIT`, contrat OpenAPI, `src/api/qerp-schema.ts`, `App.tsx`, `navigation.ts` | Fichiers partagés : modifiés seulement pour son module ; conflits résolus au rebase, jamais en écrasant |
| Codes du catalogue de droits, codes SQLSTATE `QGxxx` | Réservés à la préparation |

## 5. Règles du projet que la revue vérifie

Isolation stricte des sociétés (FK vers une autre société refusée, `install_tenant_isolation_triggers()` après tout
nouveau lien), droits du catalogue plutôt que noms de rôles, tout paramétrable par société, aucune donnée de
démonstration, interface en français, fonctions `SECURITY DEFINER` avec `search_path` et contrôle de droit et de
société, jamais exécutables par `anon`, chaque migration avec sa jumelle et son test, aucun secret dans le dépôt.
Détail : `CLAUDE.md`, `AGENTS.md`, modèle de PR.

## 6. Limites

Tous les agents poussent avec le même compte GitHub : GitHub ne peut pas imposer « approuvé par une autre personne ».
La garantie vient de la revue de la session principale et de la protection de `main` (CI verte obligatoire).
