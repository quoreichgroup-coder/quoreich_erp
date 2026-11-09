# QUOREICH — Enterprise Financial ERP

> ERP financier B2B pour PME et groupes africains, aligné sur les standards **SYSCOHADA / OHADA / IFRS**.
> Architecture multi-tenant, 100 % piloté par la base de données (zéro mock), backend Lovable Cloud (PostgreSQL + RLS).
> Interface corporate inspirée de **SAP Business One / Sage X3**, en français, devise de base **XOF**.
>
> **Version 5.0.0 — Juin 2026**

---

## Table des matières

1. [Vue d'ensemble](#vue-densemble)
2. [Stack technique](#stack-technique)
3. [Architecture](#architecture)
4. [État de stabilisation des modules](#état-de-stabilisation-des-modules)
5. [Modules métier](#modules-métier)
6. [Moteur d'imputation GL](#moteur-dimputation-gl)
7. [Multi-tenant & sécurité](#multi-tenant--sécurité)
8. [Conformité internationale](#conformité-internationale)
9. [Routes de l'application](#routes-de-lapplication)
10. [Design system](#design-system)
11. [Développement & déploiement](#développement--déploiement)

---

## Vue d'ensemble

QUOREICH est un ERP financier complet conçu pour les **PME et groupes opérant en zone OHADA** (Afrique de l'Ouest et Centrale). Il couvre l'intégralité du cycle financier :

- Comptes Clients (AR) et Comptes Fournisseurs (AP)
- Grand Livre (GL) avec plan comptable SYSCOHADA
- Trésorerie multi-banques et prévisionnel 13 semaines
- Immobilisations et amortissements
- Budget, prévisions et scénarios
- Achats (Procurement) avec 3-Way Match
- Ventes (cycle Devis → Commande → Facture)
- Comptabilité projet
- Gestion des risques et conformité / audit interne
- Centre de reporting consolidé

**Utilisateurs cibles** : Directeurs financiers, contrôleurs de gestion, comptables, responsables trésorerie, gestionnaires AP/AR, chefs de projet, auditeurs internes, responsables achats.

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Framework | React 18 + TypeScript 5 |
| Build | Vite 5 |
| Styling | Tailwind CSS 3 + shadcn/ui |
| Charts | Recharts |
| Routing | React Router v6 |
| State / data | TanStack Query v5 + hooks personnalisés |
| Tables | Hook `useTableFeatures` (tri, filtres, pagination) |
| **Backend** | **Lovable Cloud (PostgreSQL + Auth + Storage + Edge Functions)** |
| Sécurité | Row-Level Security (RLS) stricte par `tenant_id` |
| Realtime | Supabase Realtime + invalidation React Query (`use-realtime-invalidation.ts`) |
| IA | Lovable AI Gateway (cash forecast, anomalies GL, scheduler) |

> Aucune donnée mockée : toutes les pages lisent et écrivent en base via les hooks `src/hooks/use-*-data.ts`.

---

## Architecture

### Structure standardisée à 6 pages

Chaque module métier suit rigoureusement la même grille :

| Sous-page | Contenu |
|-----------|---------|
| **Dashboard** | KPIs, graphiques, alertes proactives, synthèse exécutive |
| **Transactions** | Opérations courantes, workflows d'approbation, postage GL |
| **Master Data** | Référentiels, registres, catalogues |
| **Reporting** | Analytique, consolidation, scénarios, export PDF / CSV / XLSX |
| **Control** | Alertes, contrôles de conformité, rapprochement GL, SoD |
| **Settings** | Configuration scoped tenant, seuils, mappings GL |

### Logique métier en base

La logique critique vit dans des **triggers PostgreSQL** côté Lovable Cloud :

- Auto-postage des écritures comptables (AR, AP, Trésorerie, Immobilisations, Stock)
- Équilibre DR = CR forcé sur chaque `journal_entries`
- Calcul automatique des balances âgées (vues `ar_aging_view`, `ap_aging_view`)
- Mise à jour des statuts factures via `payments` (draft → sent → partial → paid → overdue)
- Engagement budgétaire à l'émission des bons de commande
- 3-Way Match Procurement (PO ≈ GR ≈ AP Invoice) avant approbation
- Décrément stock à la confirmation des commandes de vente
- Chaîne d'audit SHA-256 immuable (`gl_audit_logs`)

Les hooks React restent **fins** : ils consomment les vues agrégées et appellent les RPC.

---

## État de stabilisation des modules

Roadmap **AR → AP → GL → Procurement → Sales** : ✅ **TERMINÉE**. Les cinq modules cœur sont stabilisés.

| Module | Statut | Détails |
|--------|--------|---------|
| **AR — Comptes Clients** | ✅ Stabilisé | 7 tables config, vue `ar_credit_exposure_view`, hooks CRUD complets, Settings / Control / Reporting 100 % DB-driven |
| **AP — Comptes Fournisseurs** | ✅ Stabilisé | 7 tables config, file d'approbation L1-L4 avec SLA, retenue à la source, balance âgée live |
| **GL — Grand Livre** | ✅ Stabilisé | Vues `gl_trial_balance` et `gl_ledger_detail`, équilibre DR=CR forcé, hash chain SHA-256, `period_locks` + RPC `close/reopen_period`, contre-passation |
| **Procurement — Achats** | ✅ Stabilisé | Cycle PR → PO → GR → AP, 3-Way Match strict, workflow approbations L1-L3, vues `procurement_audit_view` / `procurement_sla_view`, panneau RBAC audité |
| **Sales — Ventes** | ✅ Stabilisé | Cycle Quote → SO → DN → AR Invoice, auto-invoice on delivery, décrément stock, alerte limite crédit, `period_locks` Sales, vues `sales_pipeline_view` / `sales_sla_view` / `sales_kpis_view` / `sales_audit_view`, RBAC `sales_rep` / `sales_manager` / `sales_controller` audité, 6 pages standard + realtime |

> **Règle projet** : finir totalement un module (toutes pages + triggers + hooks + tests) avant de passer au suivant, sauf dépendance bloquante.


---

## Modules métier

### 1. CFO Dashboard — `/`

Tableau de bord groupe consolidé.

| KPI | Description |
|-----|-------------|
| Cash Position | Trésorerie consolidée tous comptes / entités |
| Working Capital | Actifs courants − passifs courants |
| DSO | Délai moyen de recouvrement client |
| DPO | Délai moyen de paiement fournisseur |
| EBITDA | Résultat opérationnel estimé |
| Debt Ratio | Dette totale / actifs totaux |

Fonctionnalités : comparaison N / N-1, score de risque global (0–100), alertes critiques avec drill-down, courbe trésorerie 12 mois, vue par entité, **Moteur d'imputation GL consolidé**, audit trail SHA-256.

### 2. Accounts Receivable (AR) — `/receivables`

Sous-pages : Dashboard, Transactions, Aging Analysis, Reporting, Control, Settings.

- KPIs : encours, retards, DSO, CEI
- Balance âgée 0-30 / 31-60 / 61-90 / 90+ servie par `ar_aging_view`
- Analyse de crédit : score de risque calculé côté DB (`ar_credit_exposure_view`)
- Dunning rules, séquences de numérotation, conditions de règlement configurables
- Verrouillage de période via `period_locks`
- Journal d'audit consolidé via `gl_audit_logs`

### 3. Accounts Payable (AP) — `/payables`

Sous-pages : Dashboard, Transactions, Payment Planning, Reporting, Control, Settings.

- Cycle facture : Pending → Approved → Paid → Blocked
- File d'approbation L1-L4 avec SLA et seuils configurables (`ap_approval_thresholds`)
- 3-Way Match optionnel par tenant
- Retenue à la source paramétrable (`ap_withholding_rates`)
- Escompte paiement anticipé, échéancier prévisionnel 30 jours
- Balance âgée via `ap_aging_view`

### 4. General Ledger (GL) — `/journal`

Sous-pages : Dashboard, Transactions, Master Data, Reporting, Control, Settings.

- Plan comptable SYSCOHADA (classes 1 à 7) dans `gl_accounts`, structure hiérarchique
- Saisie manuelle et écritures automatiques (depuis AR / AP / Trésorerie / Immo)
- Équilibre DR = CR forcé par trigger
- Vues serveur `gl_trial_balance` et `gl_ledger_detail`
- États : Bilan, Compte de résultat, Soldes intermédiaires de gestion (SIG)
- Audit trail hash chainé (`gl_audit_logs`)

### 5. Treasury — `/treasury`

Position de cash multi-banques, rapprochement bancaire 3 colonnes, prévisionnel 13 semaines glissant avec 4 scénarios et stress test.

### 6. Fixed Assets — `/assets`

Registre des immobilisations, amortissement linéaire et dégressif, postage GL automatique (acquisition, amortissement, cession, réévaluation), alertes maintenance / garantie / fin de vie.

### 7. Budget & Forecast — `/budget`

KPIs d'écart, Budget vs Réel, 4 scénarios (Optimiste, Base, Pessimiste, Stress), engagement budgétaire en lien avec Procurement, blocage des dépassements.

### 8. Project Accounting — `/projects`

P&L par projet, registre, Kanban, milestones, Gantt, analyse Labor / Materials / Overhead.

### 9. Procurement — `/procurement`

Cycle PR → PO → GR → AP. Workflow d'approbation 4 niveaux :

| Niveau | Seuil (XOF) | Approbateur |
|--------|-------------|-------------|
| L1 | < 5 000 000 | Chef de département |
| L2 | 5 M – 25 M | Directeur financier adjoint |
| L3 | 25 M – 100 M | CFO |
| L4 | > 100 M | Comité direction |

### 10. Risk Management — `/risk`

Catalogue de risques, score `Likelihood × Impact`, heat map, plans de mitigation, stress testing.

### 11. Compliance & Internal Audit — `/compliance`

Catalogue de contrôles, frameworks (SYSCOHADA, IFRS, ISO 27001), tests planifiés, findings, SoD.

### 12. Reporting Center — `/reports`

Bilan, Compte de résultat, Balance générale, Balance analytique. Filtres globaux, versioning Actual / Budget / Forecast, consolidation multi-entités, export PDF / Excel.

### 13. Administration — `/settings`

Exercices fiscaux, plan comptable, fiscalité, conditions de règlement, moteur de workflow (AND/OR + dry-run), matrice RBAC avec détection SoD, audit immuable.

### 14. Module Manager — `/admin/modules`

Activation / désactivation par tenant, gestion des licences par plan, validation des dépendances.

| Module | Starter | Professional | Enterprise |
|--------|---------|--------------|------------|
| GL, AR, AP | ✅ | ✅ | ✅ |
| Treasury, Fixed Assets, Budget, Procurement | ❌ | ✅ | ✅ |
| Project, Risk, Compliance | ❌ | ❌ | ✅ |

**Dépendances** : AR/AP/Treasury/Fixed Assets/Budget → GL ; Project → GL + AR + AP ; Procurement → AP.

---

## Moteur d'imputation GL

Sous-système transverse qui centralise le postage des modules auxiliaires vers le grand livre.

| Composant | Emplacement | Rôle |
|-----------|-------------|------|
| GL Posting Configuration | Onglet Settings de chaque module | Mode de batch, fréquence, journal cible, workflow |
| GL Batch History | Page Transactions de chaque module | Visualiser, poster, annuler, contre-passer |
| GL Posting KPIs | Page Transactions | Compteurs Pending / Validated / Posted / Rejected |
| Consolidated Overview | CFO Dashboard | Tableau cross-module |
| Post All Pending | CFO Dashboard | Postage en lot |
| Audit Trail | CFO Dashboard et par module | Hash chain SHA-256 immuable + rollback |

Modes : Individuel / Consolidé, fréquences Immédiat / Quotidien / Hebdo / Mensuel, journaux VJ / AJ / CJ / GJ / FAJ / BJ / PJ.

**Cycle de vie d'un batch** : Created → Submitted → Approved → Posted (ou Rejected / Cancelled), rollback par contre-passation.

---

## Multi-tenant & sécurité

### Isolation des données

- Chaque table `public` possède une colonne `tenant_id`
- RLS activée sur **toutes** les tables, policies basées sur `tenant_id = current_user_tenant()`
- Hook universel `useTenantId` (`src/hooks/use-tenant.ts`) résout le tenant depuis `profiles`
- Roles stockés dans une table dédiée `user_roles` (jamais sur `profiles`) avec fonction `has_role(_user_id, _role)` `SECURITY DEFINER`

### Authentification & RBAC

- Lovable Cloud Auth (email/password, OAuth)
- Onboarding multi-tenant via `Onboarding.tsx`
- `ProtectedRoute` guard pour toutes les routes privées
- Matrice RBAC granulaire avec détection de conflits SoD

### Conformité

| Aspect | Implémentation |
|--------|----------------|
| Isolation | RLS PostgreSQL par tenant |
| Chiffrement | AES-256 au repos, TLS 1.3 en transit |
| GDPR | Export de données, droit à l'effacement |
| SOX | Audit trail immuable, SoD |
| Intégrité audit | Hash chain SHA-256 sur `gl_audit_logs` |
| RPO | 1 heure (WAL archiving continu) |
| SLA | 99,9 % |

---

## Conformité internationale

- **SYSCOHADA / OHADA** : plan comptable classes 1-7, journaux normalisés, états SIG, présentation OHADA des états financiers
- **IFRS (IAS 1, 2, 16, 18, 36)** : présentation des états, stocks (FIFO / CMP), immobilisations, reconnaissance du revenu, dépréciation d'actifs
- **Devise de base** : XOF, multi-devise via taux de change historisés
- **Audit trail** : SHA-256 hash chain, immutabilité des écritures postées, contre-passation uniquement
- **SoD** : séparation des tâches via `user_roles` + `erp_permissions`

---

## Routes de l'application

### Finance

| Route | Module |
|-------|--------|
| `/` | CFO Dashboard |
| `/login`, `/reset-password` | Auth |
| `/onboarding` | Onboarding tenant |
| `/receivables` + `/transactions` `/aging` `/reporting` `/control` `/settings` | AR |
| `/payables` + `/transactions` `/payment-planning` `/reporting` `/control` `/settings` | AP |
| `/journal` + `/transactions` `/master-data` `/reporting` `/control` `/settings` | GL |
| `/treasury` + 5 sous-pages standard | Trésorerie |

### Modules étendus

| Préfixe | Sous-pages |
|---------|-----------|
| `/assets` | dashboard, transactions, master-data, reporting, control, settings |
| `/budget` | idem |
| `/projects` | idem |
| `/procurement` | idem |
| `/sales` | idem |
| `/expenses` | idem |
| `/inventory` | idem |
| `/risk` | idem |
| `/compliance` | idem |

### Global

| Route | Description |
|-------|-------------|
| `/reports` | Centre de reporting |
| `/settings` | Administration |
| `/admin/modules` | Module Manager |
| `/customers`, `/suppliers` | Master data partagée |
| `/docs` | Guide utilisateur interactif |
| `/data-import` | Import CSV / Excel via edge function |
| `/ai-history` | Historique des analyses IA |

---

## Design system

- **Identité** : QUOREICH — ton corporate SAP / Sage, palette navy profonde, éléments plats
- **Typographie** : IBM Plex Sans
- **Tokens couleur** : HSL sémantiques dans `src/index.css` (`--primary`, `--success`, `--destructive`, `--surface`, …)
- **Dark mode** : support complet via variables CSS
- **Langue UI** : français (zone OHADA)
- **Format monétaire** : XOF par défaut, séparateur d'espace
- **Composants partagés** : `PageShell`, `Breadcrumb`, `GuidanceBanner`, `SortableHead`, `FilterBar`, `PaginationBar`, `StatusBadge`, `KpiCards`, `EmptyState`, `HelpIcon`, `CommandPalette`

> Aucune couleur en dur (`text-white`, `bg-[#...]`) — toujours passer par les tokens sémantiques.

---

## Développement & déploiement

### Prérequis

- Node.js ≥ 18
- Lovable Cloud activé (PostgreSQL géré + Auth + Storage)

### Scripts

```bash
npm install        # installe les dépendances
npm run dev        # serveur de dev Vite (port 8080)
npm run build      # build production
npm run preview    # preview du build
npm run test       # tests Vitest
```

### Structure projet

```
src/
├── components/       # UI partagée + shadcn
├── contexts/         # AuthContext
├── hooks/            # use-*-data.ts (un par domaine métier)
├── integrations/
│   └── supabase/     # client + types auto-générés (ne pas éditer)
├── lib/              # utils, import templates, module manager
└── pages/            # 6 pages par module + globales

supabase/
├── migrations/       # toutes les migrations SQL (triggers, vues, RLS)
└── functions/        # edge functions (AI cashflow, anomalies, scheduler, import)
```

### Déploiement

Ouvrir [Lovable](https://lovable.dev) et cliquer **Share → Publish**.

URLs :
- Preview : `https://id-preview--<project>.lovable.app`
- Publié : `https://flow-bright-desk.lovable.app`

### Domaine personnalisé

**Project > Settings > Domains > Connect Domain**.
Doc : <https://docs.lovable.dev/features/custom-domain>

---

## Roadmap court terme

1. ✅ AR — Stabilisé
2. ✅ AP — Stabilisé
3. 🚧 GL — Finalisation périodes / SIG / contre-passation
4. ⏳ Procurement — Cycle complet PR → PO → GR → AP + engagement budgétaire
5. ⏳ Sales — Cycle Devis → SO → Invoice + intégration stock

Une fois ces 5 modules cœur stabilisés, extensions Treasury avancée, Project Accounting, Risk & Compliance enrichis, et reporting consolidé multi-entités.
