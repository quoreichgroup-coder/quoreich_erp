# 01 — Inventaire du projet et de la documentation

> Audit global QUOREICH (QERP) — phase 1. Constat descriptif, sans notation (la notation est faite en phase de synthèse,
> fichier 13). Toute affirmation renvoie au registre des preuves (`22_EVIDENCE_REGISTER.md`, identifiants `EV-xx`).

## 1. Version auditée

| Élément | Valeur |
|---|---|
| Dépôt | `quoreichgroup-coder/quoreich_erp` (privé) |
| Branche | `codex/finaliser-module-rh-paie` (PR #1 vers `main`) |
| Commit de référence | `3e6fd27` (26 nov. 2026) + `6258b5e` et `7392c6c` (corrections de tests, aucun code métier) |
| Historique | 130 commits depuis le 9 nov. 2026 (`git init` du dépôt) |
| Dernière migration | V154 (Flyway) — cloud Supabase `ymomubgdhufwtbsqqnas` au même niveau (EV-03) |

## 2. Composition du code (comptage, EV-01)

| Couche | Volume |
|---|---|
| Front React 19 / TypeScript / Vite 8 | 114 pages, 116 routes, 125 composants métier, 74 hooks, 80 modules `src/lib` |
| API Java 25 / Spring Boot 4.1 (sur site) | 100 classes, 34 contrôleurs |
| Base PostgreSQL 18.6 | 153 migrations Flyway, 220 migrations Supabase (jumelles depuis V16, contrôle `db:check-twins`) |
| Fonctions edge Supabase | 8 : `ai-cashflow-forecast`, `ai-gl-anomaly-detection`, `ai-scheduler`, `ar-dunning`, `bceao-rates`, `document-render`, `import-data`, `tracking-webhook` |
| Tests | Java : 100 classes d'intégration (`*IT`, Testcontainers) + 8 unitaires ; Vitest : 133 fichiers ; Playwright : 67 specs (32 parcours nuage, 6 sur site, stubs) |
| CI | `.github/workflows/ci.yml` (client web, API Java, image Docker), `deploy-supabase.yml` (manuel) |
| Infra | `infra/compose.dev.yml` (PostgreSQL + API), `infra/pdf/compose*.yml` (Gotenberg 9.2) |

## 3. Modules présents dans le code

Matrice détaillée : `01_module_inventory.csv`. Synthèse :

| Domaine | Routes front | API Java | Parcours E2E | Observation |
|---|---|---|---|---|
| Comptabilité générale, plans, états SYSCOHADA, clôture | `/journal` (7) | `LedgerController`, `ChartController`, `AccountingSetupController`, `AnalyticsController` | 50, 97, 98 | Très avancé (V18–V123) |
| Comptes clients / ventes / CRM | `/receivables`, `/sales`, `/crm`, `/customers` | `ArInvoiceController`, `ReceivableController`, `SalesController`, `CrmController`, `CustomerController`, `ArDunningController` | 40, 60, 61 | Avoirs, acomptes, lettrage, retours, devises, relances |
| Comptes fournisseurs / achats / import | `/payables`, `/procurement`, `/suppliers` | `PayableController`, `ProcurementController`, `RfqController`, `SupplierReturnsController` | 10, 20, 25, 30, 103, 105, 106 | Approbations, rapprochement 3 voies, GRNI, retenues, dossiers d'import, demandes de prix |
| Stocks / inventaires | `/inventory` | `InventoryController` | 70, 71 | Mouvements, campagnes d'inventaire, réapprovisionnement |
| Trésorerie | `/treasury` | `TreasuryController` | 80, 81 | Relevés, rapprochement, limites |
| Budget | `/budget` | `BudgetController` | 90, 92–94 | Contrôle budgétaire, pré-engagement, prévisions |
| Immobilisations | `/assets` | `AssetsController` | 91 | Amortissements, cessions |
| RH / Paie | `/hr` (10), `/payroll` | `HrController` | 95 | V80–V154 : règles versionnées, temps, libre-service, paiement |
| Notes de frais, projets | `/expenses`, `/projects` | `ExpensesController`, `ProjectsController` | 99, 100 | |
| Conformité, risques | `/compliance`, `/risk` | `GrcController` | 101 | |
| Pilotage / CFO / IA | `/cockpit`, `/ai`, `/alerts`, `/reports` | `PilotageController`, `AiController` | 102 | IA = 2 analyses (prévision de trésorerie, anomalies GL) |
| Administration, identité, documents | `/admin`, `/settings`, `/onboarding` | `AdminController`, `AuthController`, `AuthorizationController`, `DocumentsController`, `DocumentEditionsController`, `AttachmentsController`, `DataImportController` | 00, 01, 104, 107 | Identité sur site par l'API (DEC-07) |

## 4. Périmètre de la demande absent du code

Recherche effectuée dans `src/`, `services/`, `supabase/`, `docs/` (EV-04). Aucune trace d'implémentation pour :

| Périmètre demandé | Constat |
|---|---|
| QERP Mobile (React Native / Expo, prototypes V1–V5) | Aucun code mobile ; DEC-09 « Plateforme mobile secondaire » est **ouverte** dans le cahier des charges v1.1 |
| EAM (actifs techniques, ordres de travail, plans de maintenance, MTBF/MTTR) | Absent ; le module Immobilisations est comptable, pas technique |
| Downtime Management | Absent |
| Production / Fleet | Absent (cité seulement dans `docs/STACK-NOUVEAU-PROJET.md` et la demande) |
| Smart Notes | Absent |
| Business AI Hub au sens « agents ERP » | Partiel : 2 analyses IA + planificateur ; pas d'agent ni de catalogue d'outils |
| Déclaration de TVA, facturation électronique normalisée | Aucune trace (`vat_return`, SECeF, FNE : 0 fichier) |
| Internationalisation (i18n) | Aucune librairie dans le code ; dossier `docs/i18n/` (10 documents de cadrage) **non versionné**, produit par une autre session |

## 5. Documentation disponible

| Catégorie | Fichiers |
|---|---|
| Spécification | `docs/quoreich-cahier-des-charges-v1.md` (+ `.docx`, `.pdf`), `v1.1.md` (journal des changements, décisions DEC-01 à DEC-09) |
| Programme technique | `docs/PLAN-BASCULE-JAVA.md`, `docs/STACK-NOUVEAU-PROJET.md`, `CLAUDE.md`, `AGENTS.md`, `README.md`, `roadmap.md` |
| Audits fonctionnels | `docs/audit-erp/01` à `32` (cartographie, écarts, règles, cycle de vie, intégration comptable, UI/UX, architecture, plan E2E, feuille de route, puis un document par lot) |
| Recettes | `docs/recette-lot1.md`, `recette-lot2.md`, `recette-paie-v80.md`, `recette-s3-inventaires.md` |
| Conception par fonctionnalité | `docs/superpowers/plans/` (18), `docs/superpowers/specs/` (3) |
| Charte et design | `docs/charte graphique.pdf`, `docs/design-system.md` |
| Modèles de documents réels | `docs/TEMPLATES/` (5 PDF : bon de commande, processus import, guide paie…) |
| Sécurité | `docs/security/alerts-tenant-scoping-checklist.md` |

### Documents de référence cités par la demande et non fournis

Vision & Concept Paper 2030, Product Execution & Quality Plan, Product Readiness Report, prototypes Mobile V1–V5,
spécification EAM / Downtime, Smart Notes, échange « Créer un agent IA ERP », décisions **D-01 / D-02 / D-03**.
Le dépôt utilise une autre numérotation (DEC-01 à DEC-09) ; aucune correspondance D-xx ↔ DEC-xx n'est établie.
**Conséquence** : les jugements d'alignement sur la vision 2030 et sur ces décisions sont marqués « non vérifiable —
document non fourni » jusqu'à réception.

## 6. État de l'intégration continue (constat du 26 nov. 2026)

- `main` était **rouge depuis le 20 nov. 2026** (8 exécutions consécutives) : les tests Vitest important le client
  Supabase échouaient faute de `.env` en CI (EV-05). Corrigé par `6258b5e` (configuration de test seulement).
- Sur la PR #1, l'API Java présentait 12 échecs : le contrôle d'accès aux modules (V146–V147, autre session) refuse
  désormais la lecture à un compte sans droit du module ; les tests d'isolation utilisaient des comptes sans rôle
  (EV-06). Corrigé par `7392c6c` (tests seulement). **Effet produit à noter** : un utilisateur « Lecteur » (rôle
  `viewer`, aucun droit `ar.`) ne lit plus les factures clients via l'API sur site. À confirmer comme intentionnel
  (voir `06_SECURITY_AUDIT.md`).
- Le lint, les deux configurations TypeScript, le contrat OpenAPI, la synchronisation des migrations et la
  construction passent en CI.

## 7. Accès, contraintes et blocages

| Sujet | État |
|---|---|
| Code, historique, CI GitHub | Accès complet (lecture ; écriture limitée aux corrections de tests validées) |
| Base cloud Supabase | Accès SQL (pooler 6543) ; **aucun test intrusif ni écriture hors sociétés de test** |
| Copie locale `qerp_reel` (données réelles, PII) | Disponible ; lecture seule pour l'audit, aucun extrait de données dans les livrables |
| Exécution des tests | Poste à mémoire contrainte (Docker chargé) : suites complètes confiées à la CI ; exécutions locales ciblées |
| Documents de référence | Bloquant partiel (section 5) |
| Mobile / EAM / Downtime | Évaluables uniquement en « non démarré » + prérequis |
