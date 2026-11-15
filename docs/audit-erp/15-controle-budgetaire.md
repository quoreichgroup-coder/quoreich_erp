# 15 — Contrôle budgétaire (lot B1, V73 ; lot B2, V77)

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

## 4. Lot B2 (V77)

Écarts restants du lot B1, comparés à **SAP Funds Management** (fonds réservés / demandes d'achat = pré-engagement,
commandes = engagement, contrôle de disponibilité par centre financier) et à **Sage X3** (pré-engagements et engagements
budgétaires par axe analytique). Le SYSCOHADA laisse l'analytique libre (hors plan).

| # | Constat (avant V77) | Conséquence |
|---|---|---|
| B-6 | Une demande d'achat ne réservait rien : seul l'engagé (commandes) était déduit | Plusieurs demandes approuvées pouvaient dépasser le budget avant toute commande |
| B-7 | `budget_lines.analytic_value_id` existait mais aucun calcul ne la lisait ; demandes, commandes et factures fournisseurs ne portaient aucune section ; l'écriture d'achat n'imputait aucune ligne | Pas de budget par centre, département ou projet |
| B-8 | Écrans Contrôle et Prévisions : tableaux codés en dur (sociétés fictives, montants inventés, anglais) | Pilotage impossible |

Livré :

* **Pré-engagement** : une demande soumise ou approuvée, pas encore convertie, réserve le budget (`budget_precommitted`) ; la
  conversion la libère, la commande prend le relais à son approbation. Contrôle à la soumission comme une commande (refus en
  mode blocage, alerte en mode avertissement), **dérogation motivée** sur la demande (`budget_override_document`).
  Disponible = budget − pré-engagé − engagé − réalisé. Paramètres : « Pré-engager les demandes d'achat », « Contrôler les
  demandes d'achat à la soumission ».
* **Budgets par section** : une section par axe sur la demande, la commande et la facture fournisseur (tables
  `purchase_requisition_analytics`, `purchase_order_analytics`, `ap_invoice_analytics`, modifiables tant que la pièce est en
  brouillon ou rejetée) ; reprise demande → commande → facture ; l'écriture de la facture (et des factures non parvenues, retours,
  avoirs fournisseurs) impute la section à ses **lignes de charges** (sauf compte ou règle qui interdit l'axe), ce qui alimente le
  réalisé par section. Une ligne de budget sur une section contrôle les pièces de cette section **et de ses sous-sections** ; la
  pièce doit tenir dans le budget général du compte **et** dans celui de sa section. Paramètre « Contrôler les budgets par
  section analytique ».
* **Écrans** : Tableau de bord « Budget et prévisions » (budget, consommé, disponible, atterrissage, courbe cumulée budget /
  réalisé / prévision, atterrissage par compte et section — le plus prudent entre « acquis et réservé » et le réalisé au rythme
  mensuel moyen, déclaré comme tel) ; Contrôle (lignes en dépassement ou au **seuil d'alerte paramétré**, pièces passées en
  dépassement avec leur dérogation, révisions de l'exercice) ; date et sections sur la demande d'achat, sections sur la commande
  et la facture fournisseur ; section sur la ligne de budget ; colonnes pré-engagé et section dans « Engagé et disponible »,
  totaux sans double compte (`src/lib/budget-forecast.ts`).
* Tests : `BudgetPreEngagementAnalytiqueIT`, `budget-forecast.test.ts`, parcours `92-budget-analytique`.

## 5. Restant

* Section par **ligne** de pièce (aujourd'hui une section par axe et par pièce) ; contrôle des notes de frais et de la paie.
* Autres onglets des Paramètres du budget encore fictifs (UX-1) ; scénarios et versions de prévision saisis (aujourd'hui
  l'atterrissage est calculé, pas saisi).
