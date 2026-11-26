# 05 — Audit de la base de données

> Phase 3. Mesures en lecture seule sur le catalogue PostgreSQL : base de développement `qerp` (V147, EV-15) et projet
> Supabase de production (138 migrations post-socle = V154, EV-16). Aucune donnée métier lue.

## 1. Mesures

| Indicateur | Développement (V147) | Nuage (V154) |
|---|---|---|
| Tables `public` | 261 | — |
| Tables avec RLS activée | 260 (seule `flyway_schema_history` sans) | toutes |
| Tables avec `FORCE ROW LEVEL SECURITY` | 0 | — |
| Tables portant `tenant_id` (colonnes, vues incluses) | 270 | — |
| Politiques RLS | 446 | — |
| Fonctions `public` / dont SECURITY DEFINER | 562 / 403 | — / 457 |
| SECURITY DEFINER sans `search_path` figé | 0 | 0 |
| Déclencheurs | 351 | — |
| Vues / sans `security_invoker` | 46 / 0 | 46 / 0 |
| Clés étrangères / **sans index couvrant** | 529 / **328** | — |
| Tables sans clé primaire | 0 | — |
| Taille de la base de développement | 29 Mo | — |

## 2. Points forts

- **Intégrité dans la base** : contraintes, déclencheurs de garde (pièces figées après validation, séparation des tâches,
  période ouverte), colonnes calculées, numérotation sans trou sous verrou, piste d'audit chaînée SHA-256 inviolable.
- **Isolation des sociétés en profondeur** : RLS sur toutes les tables + déclencheur `assert_same_tenant` sur 61 tables qui
  vérifie chaque clé étrangère vers une autre société (V55, contrôlé par `IsolationSocietesIT`, qui échoue sur toute FK non
  couverte) + revue des fonctions à paramètre société (V101).
- **Schéma rejouable et vérifié** : socle V1–V15 comparé au dump de production (manifeste de 2 885 lignes,
  `verify-lot0.sh`), migrations jumelles contrôlées en CI, registre de déploiement avec empreinte SHA-256.

## 3. Écarts

| # | Écart | Gravité | Recommandation |
|---|---|---|---|
| D-1 | **328 clés étrangères sans index** (62 %) | Moyenne (performance future) | Indexer d'abord les FK des tables volumineuses (lignes d'écritures, mouvements de stock, paiements, lignes de pièces) ; mesurer avant / après sur une copie |
| D-2 | Aucune table en `FORCE ROW LEVEL SECURITY` | Faible | Compensé sur site par `DatabaseSecurityGuard` (l'API n'est jamais propriétaire) ; dans le nuage PostgREST n'utilise pas le rôle propriétaire |
| D-3 | Aucune politique de rétention / archivage / partitionnement | Moyenne à terme | À prévoir avant les gros volumes (écritures, mouvements, journaux d'audit) |
| D-4 | Aucun test de volumétrie ni de charge | Moyenne | Jeu de données synthétique d'une PME (5 ans) + mesure des écrans de reporting |
| D-5 | Sauvegarde / restauration non organisées | **Élevée** | DEC-08 (RPO/RTO) ouverte ; voir `12_DEVOPS_READINESS.md` |
| D-6 | La copie `qerp_reel` (données réelles, PII) vit sur le poste de développement | Moyenne | Chiffrement du disque, accès restreint, ou anonymisation pour les tests |
