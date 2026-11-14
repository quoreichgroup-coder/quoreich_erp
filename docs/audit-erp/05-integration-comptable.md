# 05 — Matrice d'intégration comptable

Aucun compte n'est inventé : les comptes cités sont ceux du **paramétrage réel** (`tenant_posting_accounts`, référentiel `SYSCOHADA_REVISE`, ou numéros codés en dur dans les fonctions, signalés comme tels). Deux sociétés de référence :

| Rôle de comptabilisation | Référentiel SYSCOHADA (société de test) | ROXGOLD SANGO (données réelles) |
|---|---|---|
| AR_RECEIVABLE | 411 | 4110 |
| SALES_REVENUE | 701 | **4000** 🧮 (classe 4 = tiers) |
| VAT_OUTPUT | 4431 | **4310** 🧮 (431 = sécurité sociale) |
| BANK | 521 | 5210 |
| AP_PAYABLE | 401 | 4010 |
| PURCHASES | 601 | 6010 |
| VAT_INPUT | 4452 | 4320 🧮 |

Le référentiel SYSCOHADA de QUOREICH est marqué `is_validated = false` : il doit être revu par un expert-comptable local (cahier des charges §138).

## Écritures automatiques

| Événement métier | Débit | Crédit | Conditions | Journal / pièce | Fonction | État |
|---|---|---|---|---|---|---|
| Facture client émise | AR_RECEIVABLE (TTC) | SALES_REVENUE ou compte de la ligne (HT, par compte) ; VAT_OUTPUT ou compte du code TVA (par compte) | Statut passe à sent / open / posted ; refus QG001 si rôle manquant | VT, `VT-AAAA-n` | `on_ar_invoice_posted` | ✅ |
| Facture client issue d'une livraison | AR_RECEIVABLE | SALES_REVENUE (HT = total des lignes livrées) | **TVA forcée à 0** | VT | `invoice_from_delivery`, `auto_invoice_on_delivery` → `on_ar_invoice_posted` | 🔴 TVA collectée omise |
| Encaissement client | BANK | AR_RECEIVABLE | INSERT de `payments` (ar_receipt), daté du paiement | BQ | `on_ap_payment_recorded` | ✅ création ; 🔴 suppression / modification non répercutées |
| Facture fournisseur approuvée | PURCHASES (HT) ; VAT_INPUT (TVA si > 0) | AP_PAYABLE (TTC) | approved + open ; QG001 si rôle manquant | AC | `ap_invoice_journal_entry` (V37) | ✅ |
| Paiement fournisseur | AP_PAYABLE | BANK | INSERT de `payments` (ap_payment), facture approuvée | BQ | `on_ap_payment_recorded` | ✅ création ; 🔴 suppression / modification |
| Paiement en espèces | — | — | `payment_method = 'cash'` passe quand même en BANK | BQ | idem | 🔴 caisse (571) absente 🧮 |
| Réception de marchandises | Stock **3100** (codé en dur) | **4010** (codé en dur — compte fournisseur) | Mouvement « posted », valeur > 0, comptes existants, sinon **rien, en silence** | OD | `on_stock_movement_je` | 🔴 latent : crédite la dette en double avec la facture ; à remplacer par stock / 408 « factures non parvenues » 🧮 |
| Livraison client (sortie) | **6010** (codé en dur, coût des ventes) | 3100 | Valeur > 0 — or la livraison est au coût 0 → rien | OD | idem | 🔴 aucun coût des ventes 🧮 (SYSCOHADA : 6031 variation de stock en inventaire intermittent) |
| Ajustement / inventaire | **6580** (codé en dur) | 3100 (ou inverse) | idem | OD | idem | 🔴 |
| Transfert entre dépôts | 3100 / **4010** puis 4010 / 3100 | idem | Les deux mouvements tombent dans la branche « autre » | OD | idem | 🔴 deux écritures parasites sur le compte fournisseur |
| Paie comptabilisée | **6610** salaires (+ 6630 charges patronales = brut × **16,4 %** codé en dur) | **4210** net ; **4310** organismes sociaux ; 4470 État | Cycle approuvé, droit `hr.execute_payroll` | PA | `post_payroll_run` | 🟡 🧮 comptes et taux non paramétrables (SYSCOHADA : 661, 664, 422, 431, 447) |
| Dotation aux amortissements | compte charge de la catégorie | compte d'amortissement de la catégorie | Immobilisation en service | OD | `post_monthly_depreciation` | 🔴 ne s'exécute pas (colonnes inexistantes), pas de contrôle de société |
| Cession d'immobilisation | — | — | — | OD | `post_asset_disposal` | 🔴 idem |
| Engagement budgétaire | (hors comptabilité) `budget_lines.actual_amount += total commande` | — | Commande approved / ordered | — | `commit_budget_on_po` | 🔴 réalisé au lieu d'engagé, deux fois |
| Rapprochement bancaire validé | selon `auto_je_on_reconciliation` | — | — | BQ | `trg_bank_recon_validated` | 🟡 ne fait qu'horodater |
| Contre-passation | inverse de l'écriture | inverse | Motif et date obligatoires, analytique recopiée | OD | `reverse_journal_entry` | ✅ |
| Écriture manuelle | saisie | saisie | Comptable / admin, brouillon → posted, équilibrée, analytique selon règles | OD | `useCreateJournalEntry` + déclencheurs | ✅ |

## Écritures manquantes (attendues par les références)

| Événement | Débit | Crédit | Référence | Priorité |
|---|---|---|---|---|
| Avoir client | 70x, 443x | 411 | Pièce de régularisation (AUDCIF) | P1 |
| Avoir fournisseur | 401 | 60x, 4452 | idem | P1 |
| Acompte client reçu / imputé | 521 / 4191 puis 4191 / 411 | | SYSCOHADA 4191 🧮 | P1 |
| Acompte fournisseur versé / imputé | 4091 / 521 puis 401 / 4091 | | SYSCOHADA 4091 🧮 | P1 |
| Réception non facturée | 31x ou 60x | 408 « fournisseurs, factures non parvenues » | SAP GR/IR, Sage X3 FNP 🧮 | P1 |
| Écart de change | 676 / 776 | | SYSCOHADA 🧮 | P1 (avec multi-devise) |
| Retenue à la source sur paiement fournisseur | 401 | 447x + 521 | Selon pays 🧮 | P2 |
| Clôture : résultat et à-nouveaux | 7x / 6x → 13 ; classes 1–5 reportées | | AUDCIF | P1 |

## Prévention des doubles comptabilisations

| Risque | Protection actuelle | État |
|---|---|---|
| Facture comptabilisée deux fois | `journal_entry_id IS NOT NULL` → sortie ; transition de statut testée | ✅ |
| Déclencheurs en double (paiements ×3 avant V16) | Supprimés en V16, historique corrigé par script | ✅ |
| Réception comptée deux fois en stock | V34 | ✅ |
| Livraison comptée deux fois en stock | — | 🔴 G-06 |
| Dette fournisseur à la réception **et** à la facture | Latent (pas de compte 3100) | 🔴 G-19 |
| Paiement supprimé, écriture conservée | — | 🔴 G-02 |
| Budget imputé deux fois par la même commande | — | 🔴 G-08 |
| Paiement rejoué (double clic) | Reste à payer ≥ montant | 🟡 pas de clé d'idempotence |

## Rapprochements entre modules (à créer)

| Rapprochement | Calcul | État |
|---|---|---|
| AR ↔ GL | Σ (total − payé) des factures ouvertes = solde de AR_RECEIVABLE | ⚪ |
| AP ↔ GL | Σ (total − payé) des factures approuvées ouvertes = solde de AP_PAYABLE | ⚪ |
| Stock ↔ GL | Σ quantité × CMP = solde des comptes de stock | ⚪ |
| Banque ↔ GL | Solde des relevés rapprochés = solde du compte 52x | 🟡 vue de statut de rapprochement |
