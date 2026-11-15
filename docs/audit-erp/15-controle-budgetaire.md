# 15 — Contrôle budgétaire (lot B1, V73 ; lot B2, V77 ; fin du module, V78)

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

## 5. Fin du module (V78)

Restants de B2, plus deux demandes du propriétaire : **préparer, exporter, importer** côté budget, et **tenir compte de la
gestion des droits et des rôles**. Références : SAP (imputation par poste de commande, versions de planification, chargement
de budget par tableur), Sage X3 (ventilation analytique par ligne, budgets par version, import de budgets).

| # | Constat (avant V78) | Conséquence |
|---|---|---|
| B-9 | Une section par axe et par **pièce** seulement | Une commande mêlant atelier et administration engageait tout sur une section |
| B-10 | Prévision toujours calculée, jamais saisie ni versionnée | Pas de révision budgétaire « officielle » (T1, T2…) |
| B-11 | Budget saisi ligne à ligne à l'écran, aucun import | Préparation d'un budget de centaines de lignes impraticable |
| B-12 | Paramètres : « GL Posting », « Fiscal Periods », « Alert Thresholds », « Approval Rules » = tableaux codés en dur, en anglais | Réglages affichés sans effet |
| B-13 | Écrans du budget ouverts par **listes de rôles** codées en dur (`useMyBudgetRoles`) ; prévisions réservées à l'administrateur | Droits non attribuables à un rôle sur mesure, écran en désaccord avec la base |

Livré :

* **Section par ligne** de demande, de commande et de facture fournisseur (`requisition_line_analytics`, `po_line_analytics`,
  `ap_invoice_line_analytics`) ; la section de la ligne l'emporte, axe par axe, sur celle de l'en-tête
  (`line_effective_analytics`). Reprise ligne de demande → ligne de commande (`po_lines.requisition_line_id`, posé par
  `convert_pr_to_po`) → ligne de facture (ligne citant la ligne de commande). Pré-engagé, engagé et contrôles calculés
  **ligne à ligne** (`document_amount_in_scope`) : la ligne générale contre le total, chaque ligne de section contre la part de
  la pièce qui la concerne. L'écriture de la facture (et des factures non parvenues à la réception) est ventilée en une ligne de
  charge par compte × ensemble de sections. Écran : « Ventiler les sections analytiques par ligne » sous les lignes.
* **Versions de prévision** (`budget_forecasts`, `budget_forecast_lines`) : créées depuis l'atterrissage calculé, le budget de
  contrôle, une version précédente ou vides ; montants modifiables (ou importés) en brouillon ; **publiées = figées**
  (`budget_forecast_publish`) ; comparées au budget et à l'atterrissage calculé ; export.
* **Préparation par fichier** : « Modèle de budget (Excel) » (pré-rempli des lignes, ou de tous les comptes de charges et
  produits), « Importer le budget » (Excel ou CSV `;`, en-têtes reconnus, montants à la française, périodes « 2041 »,
  « 03/2041 », « mars 2041 »…, ligne sans montant ignorée) ; même chose pour une version de prévision. Tout ou rien : la base
  (`import_budget_lines`, `import_budget_forecast_lines`) refuse le fichier entier en listant les anomalies (compte inconnu ou
  hors charges / produits, section inconnue ou ambiguë — écrire AXE/CODE —, période hors exercice, doublon, montant).
* **Paramètres réels** : Contrôle budgétaire ; Alertes (seuil) ; **Approbation et révisions** (règles appliquées, et
  paramètre « Révisions validées par une autre personne » au-delà d'un seuil d'écart : la révision devient une demande,
  validée ou refusée par un autre approbateur — `budget_revision_decide`) ; Exercices (calendrier fiscal central) ; Rôles et
  droits. L'onglet « GL Posting » est retiré : le budget ne passe aucune écriture.
* **Droits du catalogue** : `budget.forecast` (prévisions : administrateurs et préparateur) et `budget.export` (exports :
  exactement les rôles qui exportaient avant) — catalogue 95 ; tous les boutons du module lisent les droits (`my_access`), plus
  aucun nom de rôle ; les messages de verrouillage nomment le droit et les rôles qui le portent par défaut.
* Tests : `BudgetLignesPrevisionsImportIT`, `budget-import.test.ts`, parcours `93-budget-preparation`.

## 6. Restant

* Contrôle budgétaire des notes de frais et de la paie (modules encore hors catalogue) ; budget pluriannuel / par projet.
