# 22 — Registre des preuves

Chaque constat des livrables renvoie à une entrée de ce registre. Type : **C** = comptage / lecture du code,
**E** = exécution observée (date, environnement), **D** = document. Une entrée « E » n'est inscrite que si
l'exécution a réellement eu lieu.

| Id | Type | Date | Preuve | Résultat |
|---|---|---|---|---|
| EV-01 | C | 26/11/2026 | Comptage des fichiers (`src/pages`, `src/components`, `src/hooks`, `src/lib`, `src/App.tsx`, `services/api/src`, migrations, tests) au commit `6258b5e` | Chiffres de `01_PROJECT_INVENTORY.md` §2 |
| EV-02 | C | 26/11/2026 | `git log`, `git rev-list --count HEAD` | 130 commits ; HEAD `6258b5e` puis `7392c6c` |
| EV-03 | E | 25-26/11/2026 | Déploiement Supabase V146–V154 (`deploy-supabase.sh`), registre `qerp_deploy.applied_migrations` | 138 migrations post-socle enregistrées |
| EV-04 | C | 26/11/2026 | Recherche plein texte (`src`, `services`, `supabase`, `docs`) : Mobile, EAM, Downtime, Smart Notes, MTBF, Work Order, react-native/expo, D-01..D-03, `vat_return`, SECeF/FNE, i18n | Absents du code ; D-01/D-02 seulement dans la demande ; DEC-01..09 dans le cahier des charges |
| EV-05 | E | 26/11/2026 | CI GitHub, exécution `44746645129` (`main`) et `45734539715` (PR #1) : job « Client web » | 8 fichiers Vitest en échec « supabaseUrl is required » ; 696 tests passés par ailleurs |
| EV-06 | E | 26/11/2026 | CI GitHub, exécution `45735248294` : job « API Java » | 299 tests d'intégration, 12 échecs 403 (contrôle d'accès aux modules) |
| EV-07 | E | 26/11/2026 | Local, sans `.env` : `npx vitest run` des 8 fichiers en échec, après `6258b5e` | 8 fichiers, 45 tests passés |
| EV-08 | E | 26/11/2026 | Local (Testcontainers, PostgreSQL 18.6) : `mvnw verify -Dit.test=ApiSecurityIT,CustomersApiIT,ArInvoiceIT,ExpensesProjectsGrcApiIT,LedgerApiIT,PayableApiIT,ProcurementApiIT,StocksCrmAssetsApiIT,TreasuryBudgetSalesApiIT` après `7392c6c` | 9 classes, 39 tests passés |
| EV-09 | D | — | `docs/quoreich-cahier-des-charges-v1.md` / `v1.1.md` : DEC-07 (identités, tranchée sur site), DEC-08 (RPO/RTO, ouverte), DEC-09 (mobile, ouverte) | Décisions ouvertes à reprendre dans la feuille de route |
| EV-10 | C | 26/11/2026 | `services/api/src/main/java/.../authorization/ModuleAccessConfiguration.java`, `module-access.json` | Intercepteur : toute route `/api/v1` d'un module exige un droit du module (admin exempté) |
| EV-11 | E | 26/11/2026 | CI GitHub, exécution `45738656830` sur `7392c6c` (PR #1) : client web, API Java (`mvnw verify`, 100 classes d'intégration), image Docker | Tous les jobs verts |
| EV-12 | C | 26/11/2026 | Recherche `FROM workflow_rules` dans les migrations ; `delegat` dans les migrations | `workflow_rules` lu par aucune fonction SQL ; aucune délégation d'approbation |
| EV-13 | C | 26/11/2026 | Recherche `lot_number`, `serial_number`, `expiry_date`, déclarations paie dans les migrations | Absents (G-49, déclarations sociales) |
| EV-15 | E | 26/11/2026 | Requêtes de catalogue en lecture seule sur la base de développement `qerp` (conteneur `qerp-dev-postgres`, Flyway V147) | Chiffres de `05_DATABASE_AUDIT.md` §1 ; 46 vues toutes `security_invoker` (valeur `on` ou `true`) |
| EV-16 | E | 26/11/2026 | Requêtes de catalogue en lecture seule sur Supabase `ymomubgdhufwtbsqqnas` (pooler 6543) | 138 migrations au registre ; RLS sur toutes les tables ; 457 SECURITY DEFINER avec `search_path` ; 0 vue sans `security_invoker` ; 3 compartiments privés ; `anon` : écriture 180 tables, lecture 199 (privilèges par défaut) |
| EV-17 | E | 26/11/2026 | Nuage : politiques visant `public` / `anon` sans condition d'identité ; fonctions SECURITY DEFINER non déclencheurs exécutables par `anon` et sans contrôle d'identité dans leur corps | 0 politique ouverte ; 49 fonctions dont 6 sans contrôle visible : 4 sans risque (`get_consolidated_cfo_kpis` passe par `get_accessible_tenants`, `reopen_gl_period` ne fait que refuser, `rls_auto_enable` = déclencheur d'événement, `fiscal_module_label` = libellé), 2 exposant des identifiants (`get_user_tenant_id`, `analytic_value_scope`) |
| EV-18 | E | 26/11/2026 | `git grep` de motifs de secrets sur les fichiers suivis ; liste des fichiers sensibles suivis | Aucun résultat |
| EV-19 | C | 26/11/2026 | `supabase/config.toml` (`verify_jwt = false` ×5) et code des fonctions edge | Contrôle d'accès propre à chaque fonction (jeton utilisateur, secret partagé ou jeton de webhook) |
| EV-20 | E | 26/11/2026 | `npm audit --omit=dev` | 1 vulnérabilité élevée : `zod` (GHSA-mrhx-c7xc-m3w5), correctif en version majeure |
| EV-21 | C | 26/11/2026 | `SecurityConfig.java` ; recherche `bucket4j` / `rate limit` | CSRF désactivé (API sans état, jeton porteur) ; routes publiques `/auth/v1/token|signup|recover`, WebSocket, webhook ; aucune limitation de débit |
| EV-22 | C | 26/11/2026 | Comptage dans `src` des classes de palette Tailwind directes, classes adaptatives, attributs `aria-*`, PWA | 190 classes de palette (`amber-` 138, `blue-` 22, `red-` 18, `green-` 9, `rose-` 3) ; 819 classes adaptatives ; 535 `aria-*` ; 1 test a11y ; ni manifeste ni service worker |
| EV-23 | C | 26/11/2026 | `supabase/functions/ai-gl-anomaly-detection/index.ts` ; recherche `ai_enabled|ai_settings|consent` (migrations, fonctions, front) | Jusqu'à 150 écritures sérialisées dans l'invite ; aucun paramètre d'activation ni de consentement |
| EV-24 | D | 26/11/2026 | Références consultées : base de connaissances Supabase (révocation d'exécution), études GuardLayer, notes SAP (F_BKPF_BUK, affichage), modules Odoo de lecture seule comptable | Voir `20_DECISION_REGISTER.md` AUD-01, AUD-02 |
| EV-25 | C | 26/11/2026 | Contenu de `infra/`, fichiers suivis (`Caddyfile`, compose de production, scripts de sauvegarde / restauration), `services/api/Dockerfile`, `application.yml` | Compose de développement et Gotenberg seulement ; aucun Caddy, compose de production ni script de sauvegarde ; image non root avec `HEALTHCHECK` ; Actuator `health,info,metrics,prometheus` |
| EV-26 | E | 26/11/2026 | `gh api repos/.../branches/main` et `/rulesets` | `protected: false`, 0 rule set |
| EV-27 | C | 26/11/2026 | `src/lib/module-manager.ts` (`PLAN_MODULES`, `checkLicense`) ; recherche d'écriture de `licenses` dans les migrations ; fichier `LICENSE` | Plans définis côté front seulement ; aucune écriture de `licenses` ; pas de fichier de licence ; inventaire des licences tierces **non exécuté** (outil externe refusé) |
| EV-14 | D | 20/11/2026 | `docs/audit-erp/28-bilan-lots-et-ecarts.md` | Lots 0–5 faits fonctionnellement ; lot 1 sans déploiement VPS ; lot 6 partiel ; lot 7 (mobile) non commencé ; écarts G-25..G-50 |
