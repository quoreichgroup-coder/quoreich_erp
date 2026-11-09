# QUOREICH ERP — Guide Utilisateur

> Documentation complète pour les utilisateurs de QUOREICH ERP.
> Version 4.1.0 — Mars 2026

---

## Table des matières

1. [Introduction](#1-introduction)
2. [Prise en main](#2-prise-en-main)
3. [Tableau de bord CFO](#3-tableau-de-bord-cfo)
4. [Comptes Clients (AR)](#4-comptes-clients-ar)
5. [Comptes Fournisseurs (AP)](#5-comptes-fournisseurs-ap)
6. [Grand Livre (GL)](#6-grand-livre-gl)
7. [Trésorerie](#7-trésorerie)
8. [Immobilisations](#8-immobilisations)
9. [Budget & Prévisions](#9-budget--prévisions)
10. [Comptabilité de Projet](#10-comptabilité-de-projet)
11. [Achats (Procurement)](#11-achats-procurement)
12. [Gestion des Risques](#12-gestion-des-risques)
13. [Conformité & Audit Interne](#13-conformité--audit-interne)
14. [Centre de Reporting](#14-centre-de-reporting)
15. [Administration](#15-administration)
16. [Gestionnaire de Modules](#16-gestionnaire-de-modules)
17. [FAQ](#17-faq)

---

## 1. Introduction

QUOREICH est un ERP financier d'entreprise conçu pour les organisations de 500+ employés. Il couvre l'ensemble du cycle financier : comptes clients, comptes fournisseurs, grand livre, trésorerie, immobilisations, budgétisation, comptabilité de projet, achats, gestion des risques, conformité et reporting consolidé.

### Architecture standardisée

Tous les 10 modules métier suivent une architecture à **6 sous-pages** :

| Sous-page | Fonction |
|-----------|----------|
| **Dashboard** | KPIs, graphiques, alertes proactives, résumé exécutif |
| **Transactions** | Écritures opérationnelles, workflows d'approbation, écritures GL |
| **Master Data** | Données de référence, registres, catalogues, configuration |
| **Reporting** | Analyses, consolidation, scénarios, export (PDF/CSV) |
| **Control** | Alertes, contrôles de conformité, rapprochement GL, SoD |
| **Settings** | Configuration du module, seuils, mapping GL |

### Profils utilisateurs

| Rôle | Modules principaux |
|------|-------------------|
| CFO / Directeur Financier | Dashboard Global, Reporting, Trésorerie, Risques |
| Contrôleur de Gestion | Grand Livre, Budget, Reporting, Immobilisations |
| Responsable AR | Comptes Clients, Aging Analysis |
| Responsable AP | Comptes Fournisseurs, Payment Planning |
| Trésorier | Trésorerie, Cash Forecast, Rapprochement bancaire |
| Comptable | Grand Livre, Écritures, Plan comptable |
| Chef de Projet | Comptabilité de Projet, Budget |
| Risk Officer | Gestion des Risques, Conformité |
| Auditeur Interne | Conformité, Audit Interne |
| Responsable Achats | Procurement, Contrats fournisseurs |
| Administrateur | Administration, Workflow, Permissions, Module Manager |

---

## 2. Prise en main

### Navigation

L'application utilise une barre latérale (sidebar) à gauche, organisée en deux sections :

1. **Finance** — Les modules métier (AR, AP, GL, Trésorerie, Immobilisations, Budget, Projets)
2. **Global** — Les outils transversaux (Procurement, Risques, Conformité, Reporting, Administration)

Chaque module dispose de **6 sous-menus** : Dashboard, Transactions, Master Data, Reporting, Control, Settings.

### Structure des écrans

Tous les écrans suivent une architecture standardisée :

```
┌──────────────────────────────────────────────────┐
│ Breadcrumb : Finance > Module > Sous-page        │
├──────────────────────────────────────────────────┤
│ Titre de page                    [Actions]        │
├──────────────────────────────────────────────────┤
│ Cartes KPI (indicateurs clés)                     │
├───────┬──────────────────────────┬───────────────┤
│       │                          │               │
│Filtres│   Table de données       │ Panneau       │
│       │   principale             │ contextuel    │
│       │                          │ (détails)     │
│       │                          │               │
├───────┴──────────────────────────┴───────────────┤
│ Pagination                                        │
└──────────────────────────────────────────────────┘
```

### Actions communes sur les tableaux

Tous les tableaux interactifs supportent :
- **Tri par colonne** : Cliquer sur l'en-tête d'une colonne pour trier (asc/desc). L'icône ▲/▼ indique la direction.
- **Recherche** : Barre de recherche avec filtrage en temps réel sur plusieurs champs.
- **Filtres avancés** : Menus déroulants pour filtrer par catégorie, statut, priorité, etc. Un badge indique le nombre de filtres actifs.
- **Pagination** : Navigation par page avec affichage du nombre d'éléments (ex: « 1–10 sur 25 »).
- **Export** : Bouton Export (CSV / PDF).
- **Drill-down** : Cliquer sur une ligne pour ouvrir le panneau de détails.

---

## 3. Tableau de bord CFO

**Accès** : Cliquer sur « Dashboard Global » dans la sidebar ou naviguer vers `/`

### Vue d'ensemble

Le tableau de bord présente une vue consolidée de la santé financière du groupe, avec 6 KPIs principaux :

| KPI | Signification | Comment l'interpréter |
|-----|--------------|----------------------|
| Cash Position | Trésorerie consolidée | Un chiffre en baisse nécessite une analyse de trésorerie |
| Net Working Capital | BFR (Besoin en Fonds de Roulement) | Positif = bon signe, négatif = tension de trésorerie |
| DSO | Délai moyen d'encaissement | < 30j = excellent, > 60j = attention requise |
| DPO | Délai moyen de paiement | Optimiser sans nuire aux relations fournisseurs |
| EBITDA | Résultat d'exploitation | Tendance haussière = performance positive |
| Ratio d'endettement | Dette / Actifs totaux | < 50% = sain, > 70% = risque |

### Score de risque

Le score de risque global (0–100) est calculé automatiquement à partir de :
- Niveau de liquidité
- Vieillissement des créances (aging)
- Conformité réglementaire
- Tendance des flux de trésorerie

**Code couleur** : 🟢 Faible (0–30) · 🟡 Modéré (31–60) · 🔴 Élevé (61–100)

### Alertes critiques

Les alertes sont classées par sévérité :
- **Critical** : Action immédiate requise (ex: dépassement de plafond de crédit)
- **Warning** : Surveillance nécessaire (ex: facture en retard > 90 jours)
- **Info** : Information à noter (ex: échéance de rapprochement)

### GL Posting Engine — Vue consolidée

Le tableau de bord CFO intègre une **vue consolidée du moteur de posting GL** affichant :

| Colonne | Contenu |
|---------|---------|
| Module | Nom du module source (AR, AP, Treasury, Assets, Budget, Projects, Procurement) |
| Pending | Nombre de lots en attente de posting |
| Posted | Nombre de lots postés au GL |
| Total Posted (XOF) | Montant total posté en devise de base |

**Actions disponibles** :

- **Post All Pending** : Bouton vert permettant de poster tous les lots en attente d'un seul clic. Un dialogue de confirmation détaille le nombre de lots Pending/Validated et le montant total avant exécution.
- **Audit Trail** : Bouton toggle pour afficher/masquer l'historique d'audit détaillé.

### Historique d'Audit GL (Audit Trail)

L'audit trail est un journal immutable sécurisé par **chaîne de hachage SHA-256** :

| Champ | Description |
|-------|-------------|
| Timestamp | Date et heure de l'action |
| Batch ID | Identifiant unique du lot |
| Action | Created, Submitted, Approved, Rejected, Posted, Cancelled, Reversed, Rollback |
| User | Utilisateur ayant effectué l'action |
| Details | Description détaillée de l'opération |
| Hash Chain | Hash SHA-256 courant + référence au hash précédent |

**Rollback** : Les lots postés peuvent être annulés via le bouton rollback (icône ↩). Un dialogue de confirmation avertit que des écritures compensatoires seront créées au GL. Cette action est elle-même auditée.

---

## 4. Comptes Clients (AR)

### 4.1 Dashboard (`/receivables`)
KPIs : Total Receivables, Overdue, DSO, Collection Effectiveness Index. Graphique d'aging par tranche.

### 4.2 Transactions (`/receivables/transactions`)

| Statut | Signification |
|--------|--------------|
| Open | Facture émise, en attente de paiement |
| Partially Paid | Paiement partiel reçu |
| Paid | Facture intégralement réglée |
| Overdue | Échéance dépassée |

### 4.3 Aging Analysis (`/receivables/aging`)
Les cellules changent de couleur selon le niveau de risque :
- 🟢 **Vert** : Courant (dans les délais)
- 🟡 **Jaune** : Retard modéré (1–60 jours)
- 🔴 **Rouge** : Retard critique (60+ jours)

### 4.4 Reporting (`/receivables/reporting`)
Rapports analytiques : aging détaillé, performance des collecteurs, tendances mensuelles.

### 4.5 Control (`/receivables/control`)
Workflow d'approbation, gestion des limites de crédit, règles de validation.

### 4.6 Settings (`/receivables/settings`)
Configuration du module : règles de relance, paramètres de dunning.

---

## 5. Comptes Fournisseurs (AP)

### 5.1 Dashboard (`/payables`)
KPIs : Total Payable, Overdue, DPO, prévision de décaissement.

### 5.2 Transactions (`/payables/transactions`)

| Type | Valeurs possibles |
|------|------------------|
| Statut de paiement | Pending, Partial, Paid |
| Statut d'approbation | Pending Approval, Approved, Blocked |

### 5.3 Payment Planning (`/payables/payment-planning`)

| Priorité | Signification |
|----------|--------------|
| Critical | Paiement urgent, fournisseur stratégique |
| High | Échéance proche, risque de pénalité |
| Normal | Échéance standard |
| Low | Paiement reportable sans impact |

### 5.4 Reporting (`/payables/reporting`)
Analytique AP : aging fournisseurs, performance de paiement, tendances.

### 5.5 Control (`/payables/control`)
Workflows d'approbation multi-niveaux, règles de validation.

### 5.6 Settings (`/payables/settings`)
Conditions de paiement, configuration fiscale.

---

## 6. Grand Livre (GL)

### 6.1 Dashboard / Écritures (`/journal`)
Indicateur d'équilibre :
- 🟢 **Balanced** : Total Débit = Total Crédit
- 🔴 **Unbalanced** : Écart détecté

### 6.2 Transactions (`/journal/transactions`)
Saisie d'écritures manuelles et automatiques avec validation en temps réel.

### 6.3 Plan comptable (`/journal/master-data`)
Structure en 3 panneaux : arbre hiérarchique, tableau de détail, configuration par compte.

### 6.4 Reporting (`/journal/reporting`)
Balance générale, compte de résultat, bilan.

### 6.5 Control (`/journal/control`)
Gestion des périodes, clôture, piste d'audit.

### 6.6 Settings (`/journal/settings`)
Configuration GL, comptes par défaut.

---

## 7. Trésorerie

### 7.1 Dashboard (`/treasury`)
Position de trésorerie consolidée multi-banques, graphique 30 jours.

### 7.2 Transactions (`/treasury/transactions`)
Flux entrants/sortants, rapprochement bancaire (interface 3 colonnes).

### 7.3 Master Data (`/treasury/master-data`)
Comptes bancaires, contreparties, instruments.

### 7.4 Reporting (`/treasury/reporting`)
Prévision de trésorerie 13 semaines, 4 scénarios, stress testing.

### 7.5 Control (`/treasury/control`)
Contrôles de rapprochement, scoring de confiance.

### 7.6 Settings (`/treasury/settings`)
Paramètres de trésorerie, connectivité bancaire.

---

## 8. Immobilisations

### 8.1 Dashboard (`/assets`)
KPIs : Valeur Nette Comptable totale, charge d'amortissement, nombre d'actifs. Répartition par catégorie, évolution mensuelle, alertes proactives.

### 8.2 Transactions (`/assets/transactions`)
Registre des acquisitions, cessions et réévaluations. Workflow de validation. Journal des écritures GL automatiques.

### 8.3 Master Data (`/assets/master-data`)
Registre complet des actifs avec panneau de détail latéral. Contrats de leasing, garanties, planning de maintenance.

| Champ | Description |
|-------|-------------|
| Code | Identifiant unique (FA-001) |
| Catégorie | IT Equipment, Vehicles, Furniture, Building Equipment |
| Méthode | Linear ou Declining Balance |
| VNC | Valeur Nette Comptable = Coût − Amortissement cumulé |
| Statut | Active, Fully Depreciated, Disposed, Under Maintenance |

### 8.4 Reporting (`/assets/reporting`)
Tableau d'amortissement complet. Reporting par catégorie, localisation et département.

**Calcul d'amortissement** :
- **Méthode linéaire** : `Dotation = (Coût − Valeur résiduelle) / Durée d'utilité`
- **Méthode dégressive** : `Dotation = VNC × Taux dégressif (%)` — Plancher : VNC ≥ Valeur résiduelle

### 8.5 Control (`/assets/control`)
Alertes fin de vie, maintenance et garantie. Vérifications d'intégrité. Rapprochement avec le GL.

### 8.6 Settings (`/assets/settings`)
Méthodes d'amortissement, catégories d'actifs, mapping comptes GL, cycles de maintenance.

### Intégration GL

| Événement | Débit | Crédit |
|-----------|-------|--------|
| Acquisition | Compte d'immobilisation | Banque / Fournisseur |
| Amortissement | Dotation aux amortissements | Amortissements cumulés |
| Cession | Amort. cumulés + Banque | Immobilisation ± Plus-value |
| Réévaluation | Compte d'immobilisation | Réserve de réévaluation |

---

## 9. Budget & Prévisions

### 9.1 Dashboard (`/budget`)
KPIs : Budget Total, Réalisé YTD, Écart Net, Utilisation Budget (%). Graphique Budget vs Actual. Alertes de dépassement.

### 9.2 Transactions (`/budget/transactions`)
Écritures budgétaires, révisions, historique des modifications avec piste d'audit.

### 9.3 Master Data (`/budget/master-data`)
Lignes budgétaires par département et entité. Configuration des enveloppes. Règles d'allocation.

### 9.4 Reporting (`/budget/reporting`)
Consolidation multi-entité. **4 scénarios** : Optimistic, Base, Pessimistic, Stress Test. Analyse des écarts (variance analysis). Export PDF/CSV.

### 9.5 Control (`/budget/control`)
Alertes de dépassement budgétaire. Contrôle des engagements. Blocage automatique si over-budget. Prévision de trésorerie.

### 9.6 Settings (`/budget/settings`)
Périodes fiscales, devises, seuils d'alerte, règles d'approbation budgétaire.

---

## 10. Comptabilité de Projet

### 10.1 Dashboard (`/projects`)
KPIs : Projets Actifs, Revenu Total, Coûts Totaux, Marge Moyenne. Graphique de burndown budgétaire.

### 10.2 Transactions (`/projects/transactions`)
Écritures de coûts et revenus par projet. Liens avec GL, AP et AR. Journal des imputations.

### 10.3 Master Data (`/projects/master-data`)
Registre des projets : création, édition, affectation d'équipes, jalons. **Kanban board** pour le suivi visuel.

| Colonne | Description |
|---------|-------------|
| Projet | Nom et identifiant |
| Client | Client associé |
| Revenu | Montant des revenus |
| Coûts | Montant des dépenses |
| Marge % | Pourcentage de marge |
| Statut | Active, Completed, On Hold |

### 10.4 Reporting (`/projects/reporting`)
P&L par projet. **Gantt timeline**. Analyse des coûts : Labor vs Materials vs Overhead.

### 10.5 Control (`/projects/control`)
Alertes de dépassement budget par projet. Suivi des retards. Rapprochement GL.

### 10.6 Settings (`/projects/settings`)
Catégories de coûts, taux horaires, règles de comptabilisation GL.

---

## 11. Achats (Procurement)

### 11.1 Dashboard (`/procurement`)
KPIs : Total Spend, Open POs, SLA Compliance, Contract Utilization. Graphiques d'analyse des dépenses (spend analytics).

### 11.2 Transactions (`/procurement/transactions`)
Demandes d'achat (Purchase Requisitions) et bons de commande (Purchase Orders). **Workflow d'approbation L1-L4** :

| Niveau | Seuil | Approbateur |
|--------|-------|-------------|
| L1 | < 5 000 | Chef de département |
| L2 | 5 000 – 25 000 | Responsable financier |
| L3 | 25 000 – 100 000 | CFO |
| L4 | > 100 000 | Comité de direction |

### 11.3 Master Data (`/procurement/master-data`)
Répertoire des fournisseurs. Registre des contrats avec suivi d'utilisation et alertes d'expiration. Monitoring SLA.

### 11.4 Reporting (`/procurement/reporting`)
Top fournisseurs par dépense. Coût par catégorie. Délais moyens de livraison. Analyse des tendances.

### 11.5 Control (`/procurement/control`)
Alertes de dépassement budget. Suivi des retards de livraison. Contrôles de conformité. Piste d'audit.

### 11.6 Settings (`/procurement/settings`)
Niveaux et seuils d'approbation. Catégories d'achats. Mapping comptes GL.

### Niveaux de priorité

| Priorité | Signification |
|----------|--------------|
| Critical | Besoin urgent, impact production |
| High | Délai serré, fournisseur unique |
| Normal | Processus standard |
| Low | Achat non urgent, reportable |

---

## 12. Gestion des Risques

### 12.1 Dashboard (`/risk`)
KPIs : Risques Totaux, Critiques/Élevés, Score Moyen, % Mitigés. Radar chart et heat map.

### 12.2 Transactions (`/risk/transactions`)
Registre des événements de risque. Incidents. Actions correctives avec suivi.

### 12.3 Master Data (`/risk/master-data`)
Catalogue des risques avec propriétaires. Catégories (Financial, Operational, Compliance). Stratégies de mitigation.

| Colonne | Description |
|---------|-------------|
| Risque | Nom et description |
| Catégorie | Financial, Operational, Compliance |
| Probabilité | Low, Medium, High |
| Impact | Low, Medium, High, Critical |
| Score | Probabilité × Impact (0–100) |
| Propriétaire | Responsable de la mitigation |

### 12.4 Reporting (`/risk/reporting`)
Évolution des scores dans le temps. Stress testing. Rapports par catégorie et entité.

### 12.5 Control (`/risk/control`)
Suivi des plans de mitigation. Alertes SLA. Gestion des escalades.

### 12.6 Settings (`/risk/settings`)
Matrices impact/probabilité. Seuils de risque. Catégories. Règles de notification.

---

## 13. Conformité & Audit Interne

### 13.1 Dashboard (`/compliance`)
KPIs : Efficacité des contrôles (%), Constats ouverts. Graphiques de tendances. Résumé de conformité.

### 13.2 Transactions (`/compliance/transactions`)
Log des exécutions de tests de contrôle. Résultats. Historique des vérifications.

### 13.3 Master Data (`/compliance/master-data`)
Catalogue des contrôles internes. Référentiels (SOX, IFRS, ISO 27001). Mapping des responsables.

### 13.4 Reporting (`/compliance/reporting`)
Rapports d'audit. Tendances de conformité. Gap analysis. Progression des remédiations.

### 13.5 Control (`/compliance/control`)
Registre des constats d'audit. Suivi de remédiation. Conflits de Séparation des Tâches (SoD).

| Sévérité | Code couleur |
|----------|-------------|
| Critical | 🔴 Rouge |
| High | 🟠 Orange |
| Medium | 🟡 Jaune |
| Low | 🔵 Bleu |

### 13.6 Settings (`/compliance/settings`)
Référentiels actifs, fréquences de test, seuils de sévérité, règles de notification.

---

## 14. Centre de Reporting

**Accès** : `/reports`

### Rapports disponibles

| Rapport | Description |
|---------|-------------|
| Bilan (Balance Sheet) | Actifs / Passifs / Capitaux propres avec comparatif N-1 |
| Compte de résultat (Income Statement) | Produits vs Charges avec graphique trimestriel |
| Balance générale (Trial Balance) | Débit / Crédit avec indicateur d'équilibre |
| Balance analytique | Par centre de coût, département, projet ou région |

### Filtres globaux
- Exercice fiscal, Période, Entité, Devise

### Versioning
- **Actual** (réel) / **Budget** (prévisionnel) / **Forecast** (prévision glissante)

### Export
- PDF, Excel, Impression

---

## 15. Administration

**Accès** : `/settings`

### 15.1 Exercices fiscaux
Gérer les exercices comptables et les périodes de clôture.

### 15.2 Plan comptable
Configurer la structure des comptes (voir section GL).

### 15.3 Configuration fiscale
Définir les taux de TVA et règles d'imposition applicables.

### 15.4 Conditions de paiement
Bibliothèque de termes standards (Net 30, Net 60, 2/10 Net 30, etc.).

### 15.5 Moteur de workflow

- Conditions multi-variables (montant, devise, centre de coût, département)
- Combinateurs AND / OR pour logique complexe
- Délégation temporaire d'approbateurs
- Escalade conditionnelle selon SLA
- Simulation dry-run avant activation

### 15.6 Matrice de permissions (RBAC)

| Permission | Description |
|-----------|-------------|
| Read | Consulter les données |
| Create | Créer de nouveaux enregistrements |
| Edit | Modifier des enregistrements existants |
| Validate | Approuver / rejeter |
| Delete | Supprimer (avec traçabilité) |
| Export | Exporter les données |

**Détection SoD** : Identification automatique des conflits de séparation des tâches.

### 15.7 Audit & Conformité
Journal d'audit inviolable avec horodatage, adresse IP, chaîne de hachage SHA-256.

---

## 16. Gestionnaire de Modules

**Accès** : `/admin/modules`

### Vue d'ensemble

Le Module Manager permet aux administrateurs de gérer le cycle de vie des modules par tenant : activation, désactivation, licences et audit.

### Fonctionnalités

| Fonction | Description |
|----------|-------------|
| Sélecteur de tenant | Basculer entre entités pour voir l'état des modules |
| Grille de modules | Activer/désactiver avec validation des dépendances |
| Gestion des licences | Suivi par tenant et par module avec application des plans |
| Simulateur de workflow | Test dry-run des règles d'approbation |
| Piste d'audit | Log immuable avec chaîne SHA-256 |

### Plans et disponibilité

| Module | Starter | Professional | Enterprise |
|--------|---------|-------------|------------|
| Grand Livre | ✅ | ✅ | ✅ |
| Comptes Clients | ✅ | ✅ | ✅ |
| Comptes Fournisseurs | ✅ | ✅ | ✅ |
| Trésorerie | ❌ | ✅ | ✅ |
| Immobilisations | ❌ | ✅ | ✅ |
| Budget & Prévisions | ❌ | ✅ | ✅ |
| Comptabilité de Projet | ❌ | ❌ | ✅ |
| Gestion des Risques | ❌ | ❌ | ✅ |
| Conformité | ❌ | ❌ | ✅ |
| Achats | ❌ | ✅ | ✅ |

### Dépendances entre modules

- **AR / AP** → nécessite **GL**
- **Trésorerie** → nécessite **GL**
- **Immobilisations** → nécessite **GL**
- **Budget** → nécessite **GL**
- **Comptabilité de Projet** → nécessite **GL + AR + AP**
- **Achats** → nécessite **AP**
- **Risques / Conformité** → autonomes

### Tenants configurés

| Tenant | Plan | Modules Actifs | Utilisateurs |
|--------|------|---------------|-------------|
| QUOREICH Group (T-001) | Enterprise | 10 modules | 250 |
| QUOREICH Sénégal (T-002) | Professional | 7 modules | 100 |
| QUOREICH Mali (T-003) | Starter | 3 modules | 25 |

---

## 17. FAQ

### Comment changer de module ?
Utilisez la barre latérale (sidebar) à gauche. Cliquez sur le nom du module pour déplier ses sous-menus (Dashboard, Transactions, Master Data, Reporting, Control, Settings).

### Comment exporter des données ?
Chaque tableau dispose d'un bouton **Export** en haut à droite. Les formats disponibles sont CSV et PDF.

### Comment filtrer les données ?
Utilisez la barre de filtres au-dessus du tableau. Les filtres sont cumulatifs (AND). Un badge indique le nombre de filtres actifs.

### Comment trier les données ?
Cliquez sur l'en-tête d'une colonne. Une flèche ▲/▼ indique la direction du tri. Cliquez à nouveau pour inverser.

### Comment consulter le détail d'un enregistrement ?
Cliquez sur n'importe quelle ligne dans un tableau. Un panneau latéral s'ouvrira avec les informations détaillées.

### Que signifient les couleurs dans les tableaux ?
- 🟢 **Vert** : Statut positif (payé, équilibré, dans les délais)
- 🟡 **Jaune** : Attention requise (retard modéré, partiellement traité)
- 🔴 **Rouge** : Action urgente (retard critique, déséquilibre, bloqué)

### Comment fonctionne le score de risque ?
Le score est calculé automatiquement entre 0 et 100 en pondérant : la liquidité disponible, le vieillissement des créances, les indicateurs de conformité et la tendance des flux de trésorerie.

### Comment lancer le calcul d'amortissement ?
Dans Immobilisations > Transactions, cliquez sur **Run Depreciation**. Le système calculera les dotations pour la période courante et générera les écritures GL correspondantes.

### Comment activer un nouveau module ?
Accédez à `/admin/modules`, sélectionnez le tenant, puis cliquez sur **Activate** pour le module souhaité. Le système vérifie automatiquement la licence et les dépendances.

### Quels modules sont disponibles pour mon plan ?
Consultez le tableau de disponibilité dans la section Gestionnaire de Modules. Le plan Starter inclut GL/AR/AP, le Professional ajoute Trésorerie/Immobilisations/Budget/Achats, et l'Enterprise donne accès à tous les modules.

### Où trouver les sous-pages d'un module ?
Chaque module dispose de 6 sous-pages accessibles via la sidebar : Dashboard (vue d'ensemble), Transactions (opérations), Master Data (données de référence), Reporting (analyses), Control (contrôles), Settings (configuration).

---

*QUOREICH ERP v4.0.0 — © 2026*
