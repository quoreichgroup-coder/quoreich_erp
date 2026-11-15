# 16 — Immobilisations : amortissements et cessions (lot F1, V75)

Audit de l'existant du 15 nov. 2026, comparé à SAP, Sage et au SYSCOHADA révisé, puis livraison. Écarts
traités : **G-11** (fonctions exécutables par tout utilisateur sur la société passée en paramètre) et **G-20**
(amortissements et cessions impossibles). Étape 5 de la priorité P1 de la feuille de route (09).

## 1. Constats

| # | Constat | Preuve | Conséquence |
|---|---|---|---|
| F-1 | Amortir et céder impossible | `post_monthly_depreciation` / `post_asset_disposal` écrivaient `journal_entries.reference` et `journal_lines.journal_entry_id` (colonnes inexistantes), en-tête inséré « posted » sans lignes | Résultat et bilan faux dès qu'une immobilisation existe |
| F-2 | Société en paramètre | `post_monthly_depreciation(_tenant_id, …)` exécutable par `authenticated` | Réparée telle quelle : écriture dans une autre société (G-11) |
| F-3 | Tables ouvertes | `assets`, `asset_categories`, `depreciation_entries`, `asset_disposals` en `FOR ALL` | Cumul et VNC saisissables par tout membre |
| F-4 | Paramètres fictifs | Immobilisations → Paramètres : tableaux codés en dur | — |

Aucune immobilisation n'existait (copie réelle et nuage).

## 2. Références

* **SAP Asset Accounting** : catégorie → comptes (immobilisation, amortissements, dotation) ; calcul périodique,
  contre-passation ; cession avec amortissement du prorata de l'exercice, sortie de la valeur et du cumul.
* **Sage Immobilisations** : plan d'amortissement, dotations, cessions et mises au rebut.
* **SYSCOHADA révisé** : 2x immobilisations, 28x amortissements, 681x dotations ; cession en HAO : 81x valeur comptable
  des cessions, 82x produits des cessions, 485 créances sur cessions d'immobilisations ; linéaire, dégressif admis.

## 3. Livré (V75)

* **Catégories** : comptes 2x / 28x / 68x obligatoires et contrôlés.
* **Fiche** : coût, valeur résiduelle, durée, méthode, mise en service ; **reprise d'un registre existant** (cumul
  d'ouverture arrêté à une date) ; cumul et VNC **calculés** ; fiche figée dès le premier amortissement, et après cession.
* **Calcul mensuel** (`run_depreciation`, droit `assets.depreciate`) : linéaire, premier mois au prorata des jours
  (paramétrable) ; dégressif avec coefficients paramétrables (1,5 / 2 / 2,5 selon la durée, **à valider localement** 🧮),
  bascule en linéaire ; une écriture OD par calcul ; idempotent ; contre-passation du dernier calcul motivée.
* **Sortie** (`dispose_asset`, droit `assets.dispose`) : dotation du mois jusqu'à la date, sortie DR 28x + DR 81x (VNC)
  / CR 2x, prix DR 485 (ou banque) / CR 82x, plus-ou-moins-value tracée ; exige que les mois précédents soient amortis.
* **Sécurité** : société résolue côté serveur, droits du catalogue `assets.manage`, `assets.depreciate`, `assets.dispose`,
  `assets.settings` (catalogue 93), amortissements, calculs et cessions en lecture seule ; les deux fonctions cassées sont
  supprimées.
* Écrans : Paramètres « Catégories et amortissements », fiche (mise en service, reprise, **sortie**), Transactions
  (« Calculer les amortissements », « Contre-passer le dernier calcul »).

**V76** : un compte de référence « mixte » porte ses types admis (`allowed_types`) ; la classe 8 SYSCOHADA (HAO) admet charges et produits, la classe 1 capitaux propres et dettes. Le contrôle du plan ne signale plus à tort le regroupement « 8 ».

## 4. Restant

* Création de la fiche depuis une ligne de facture fournisseur (compte 2x) ; amortissements dérogatoires et fiscaux.
* Écrans encore partiellement fictifs du module (Contrôle, Rapports).
