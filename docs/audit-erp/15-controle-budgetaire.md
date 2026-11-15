# 15 — Contrôle budgétaire (lot B1, V73)

Audit de l'existant du 15 nov. 2026, comparé à SAP et Sage, puis livraison. Écart traité : **G-08**
(engagement budgétaire). Étape 4 de la priorité P1 de la feuille de route (09).

## 1. Constats

| # | Constat | Preuve | Conséquence |
|---|---|---|---|
| B-1 | « Engagement » faux | `commit_budget_on_po` ajoutait le total de la commande au **réalisé** (`actual_amount`), deux fois (approuvée puis commandée), jamais libéré, sur le premier budget approuvé trouvé (`LIMIT 1`), sans compte | Budget / réel faux ; décisions sur des chiffres faux |
| B-2 | Aucun contrôle de disponibilité | aucune vérification avant approbation d'une commande ou d'une facture | Dépassements découverts après coup |
| B-3 | Aucun cycle de vie | un budget « approuvé » restait modifiable par tout membre (`FOR ALL`) | Budget de référence non fiable |
| B-4 | Droits par rôles hors catalogue | `budget-roles.ts` | Non attribuables à un rôle sur mesure |
| B-5 | Écrans de démonstration | Transactions, Contrôle, Prévisions, Paramètres : tableaux codés en dur, en anglais | — |

Aucune donnée budgétaire n'existait (copie réelle et nuage) : la refonte n'a rien eu à migrer.

## 2. Références

* **SAP** (contrôle de disponibilité FM / CO) : budget, engagements (commandes), réel, disponible ; tolérances
  avertissement / blocage ; compléments et restitutions de budget tracés.
* **Sage** : contrôle budgétaire des engagements d'achat, budget de référence par exercice.

## 3. Livré (V73)

* **Cycle de vie** : brouillon → soumis → approuvé **par une autre personne** (droit `budget.approve`) → clos ; un seul
  budget de **contrôle** approuvé par exercice ; lignes figées après approbation, **révision** motivée et tracée
  (`budget_revisions`).
* **Ligne** = compte (ses sous-comptes compris : « 60 » contrôle 601, 604…) × année ou mois.
* **Engagé** = commandes approuvées non soldées (net − factures fournisseurs approuvées qui les citent), au compte du rôle
  Achats ; **réalisé** = écritures validées ; **disponible** = budget − engagé − réalisé. Tout est recalculé à la demande :
  aucun cumul stocké, donc aucune dérive possible.
* **Contrôle** (paramètre, désactivé par défaut ; avertir ou bloquer ; niveau annuel ou mensuel) à la soumission et à
  l'approbation d'une commande et à la soumission d'une facture fournisseur sans commande ; dépassement bloquant levé par
  un habilité (`budget.override`, motif tracé sur la commande).
* Droits du catalogue `budget.manage`, `budget.approve`, `budget.override`, `budget.settings` (catalogue 89).
* Écrans : Budget → Transactions (budgets réels, lignes, soumission, approbation, révision ; onglet « Engagé et
  disponible »), Paramètres → « Contrôle budgétaire » ; sur la commande : « Budget dépassé » et « Autoriser le dépassement ».

## 4. Restant

* Pré-engagement des demandes d'achat ; budgets par axe analytique (la colonne existe, le contrôle ne l'utilise pas encore).
* Écrans encore fictifs du module : Contrôle, Prévisions, autres onglets des Paramètres (UX-1).
