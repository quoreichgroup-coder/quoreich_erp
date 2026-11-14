# 03 — Spécification des règles métier

Chaque règle est formulée pour être **testable** (un test qui échoue si la règle est violée). Colonne « État » : ✅ prouvé par test · 🟢 code présent · 🟡 partiel / contournable · 🔴 violé · ⚪ absent. « Où » = mécanisme qui doit porter la règle (toujours la base, puisque l'API REST est exposée).

## R-TR — Règles transverses

| Id | Règle | État | Preuve / écart |
|---|---|---|---|
| R-TR-01 | Toute écriture porte sur la société de l'utilisateur ; toute référence (tiers, facture, commande, article, compte) appartient à la même société | 🔴 | ✅ pour les factures ↔ commandes (V36), réceptions (V34) ; 🔴 paiements [S13] |
| R-TR-02 | Une pièce validée (émise, approuvée, comptabilisée) n'est plus modifiable ni supprimable ; seule une pièce de régularisation la corrige | 🟡 | ✅ réceptions (V34), achats (V39), facture AP (V41), écritures (V38) ; 🔴 facture AR [S1, S12], paiements [S3, S4] |
| R-TR-03 | Les changements de statut passent par une fonction qui vérifie la transition, le droit et la séparation des tâches | 🟡 | ✅ achats, AP ; 🔴 AR, budget [S15], notes de frais, trésorerie |
| R-TR-04 | Les totaux de pied sont recalculés en base à partir des lignes, jamais acceptés du client | 🟡 | ✅ AR (V21), commandes / demandes (`recompute_*`), devis ; 🔴 factures issues de livraison (TVA 0) ; ⚪ facture AP (en-tête seul) |
| R-TR-05 | Montants en `numeric(18,2)`, quantités et coûts unitaires en précision suffisante (≥ 4 décimales) | 🟡 | Montants AR / paiements 18,2 ✅ ; plusieurs colonnes `numeric` sans précision (budgets, bank_accounts.balance) — sans risque d'arrondi mais sans contrôle d'échelle |
| R-TR-06 | Toute opération dans une période close du module est refusée (QG003) | ✅ | `assert_fiscal_period_open`, CalendrierFiscalIT ; exceptions : immobilisations (lisent encore `period_locks` directement) |
| R-TR-07 | Toute modification d'une donnée comptable ou d'autorisation laisse une trace non effaçable | 🔴 | `erp_authorization_audit`, `fiscal_calendar_audit` ✅ ; `gl_audit_logs` effaçable [S6] |
| R-TR-08 | Une opération rejouée (double clic, nouvel envoi) ne produit pas d'effet en double | ⚪ | Pas de clé d'idempotence ; protégé indirectement pour les règlements (reste à payer) |
| R-TR-09 | Numérotation légale : continue, sans trou, unique par série et exercice, attribuée à la validation | 🟡 | ✅ AR (V22), ventes (V40), pièces GL (V38) ; 🔴 factures issues de livraison (aléatoire) ; ⚪ AP (numéro interne) |

## R-O2C — Vente → encaissement

| Id | Règle | État |
|---|---|---|
| R-O2C-01 | Devis, commande, livraison : numéro attribué par la base, non modifiable une fois émis | ✅ NumerotationVentesIT |
| R-O2C-02 | Un devis expiré (`valid_until` dépassée) ne se convertit pas | ⚪ non vérifié par `convert_quote_to_so` |
| R-O2C-03 | La conversion devis → commande est unique (un devis = une commande) | 🟢 `convert_quote_to_so` renvoie la commande existante |
| R-O2C-04 | Commande confirmée seulement si l'encours + la commande ≤ limite de crédit, sauf levée habilitée | 🟡 notification seulement |
| R-O2C-05 | Livraison ≤ reliquat par ligne ; stock décrémenté **une fois**, au coût CMP / FIFO | 🔴 reliquat ✅, stock ×2 au coût 0 |
| R-O2C-06 | Facture issue d'une commande / livraison : reprend lignes, prix, remises et codes TVA ; une livraison n'est facturée qu'une fois | 🔴 TVA 0, sans lignes ; « une fois » ✅ (`ar_invoice_id`) |
| R-O2C-07 | Facture émise → écriture VT équilibrée : 411 / 70x / 443x, datée de la facture | ✅ parcours 40-clients, IT Lot 2 |
| R-O2C-08 | Encaissement ≤ reste dû ; seules les factures du client choisi | ✅ V36 (`record_settlement`) ; 🔴 contournable en direct [S13] |
| R-O2C-09 | Annulation d'une facture émise = avoir numéroté qui contre-passe l'écriture | ⚪ |
| R-O2C-10 | Acompte reçu avant facture, imputé ensuite | ⚪ |
| R-O2C-11 | Échéance = date de facture + conditions du client | ⚪ (+30 j) |

## R-P2P — Achat → paiement

| Id | Règle | État |
|---|---|---|
| R-P2P-01 | Demande / commande : brouillon → soumission (≥ 1 ligne) → approbation par niveaux selon seuils | ✅ CycleDeVieAchatsIT, parcours 20-achats |
| R-P2P-02 | L'auteur n'approuve jamais sa pièce ; un approbateur ne valide pas deux niveaux | ✅ |
| R-P2P-03 | Commande directe refusée si la société exige une demande | ✅ QG007 |
| R-P2P-04 | Réception ≤ reste à recevoir par ligne ; commande « partiellement reçue » / « reçue » | ✅ V34 |
| R-P2P-05 | Facture AP : même fournisseur que la commande ; numéro fournisseur unique par fournisseur | ✅ V36, V41 |
| R-P2P-06 | Rapprochement 3 voies : HT facturé ≤ reçu non facturé + max(tolérance montant, %) | ✅ V41 (global) ; ⚪ ligne à ligne, écart de prix / quantité distincts |
| R-P2P-07 | Facture AP approuvée par un tiers habilité → écriture AC 60x / 4452 / 401 | ✅ V37, V41 |
| R-P2P-08 | Paiement seulement d'une facture approuvée, ≤ reste dû | ✅ `guard_ap_payment`, V36 ; 🔴 suppression / modification [S3, S4] |
| R-P2P-09 | Réception → écriture d'attente (factures non parvenues), soldée par la facture | ⚪ 🧮 |
| R-P2P-10 | Retour fournisseur réduit la quantité reçue et le stock ; avoir fournisseur réduit la dette | ⚪ |
| R-P2P-11 | Engagement budgétaire à l'approbation de la commande, libéré à l'annulation, transformé en réalisé à la facture | 🔴 |

## R-R2R — Comptabilité générale

| Id | Règle | État |
|---|---|---|
| R-R2R-01 | Écriture comptabilisée : débit = crédit, ≥ 2 lignes | ✅ `enforce_balanced_entry` |
| R-R2R-02 | Écriture comptabilisée intangible ; correction par contre-passation datée et motivée | ✅ V38, JournauxEtLotsIT |
| R-R2R-03 | Chaque écriture a un journal, un numéro de pièce continu par journal et par année, un lot | ✅ V38 |
| R-R2R-04 | Aucune écriture automatique ne doit être « silencieusement » omise : paramétrage incomplet → refus explicite QG001 | 🟡 ✅ AR, AP, paiements ; 🔴 stock (sortie silencieuse), immobilisations |
| R-R2R-05 | Aucun numéro de compte codé en dur dans une comptabilisation automatique | 🔴 stock, paie, immobilisations |
| R-R2R-06 | Solde du compte collectif 411 / 401 = somme des postes ouverts des tiers (rapprochement auxiliaire ↔ général) | ⚪ pas d'état ; 🔴 cassé par S1, S3 |
| R-R2R-07 | Clôture d'exercice : résultat déterminé, à-nouveaux générés | ⚪ |

## R-INV — Stock

| Id | Règle | État |
|---|---|---|
| R-INV-01 | Le stock ne bouge que par mouvement ; jamais par mise à jour directe de la quantité | 🔴 [S14], `post_delivery` |
| R-INV-02 | Sortie refusée si stock insuffisant (sauf paramètre stock négatif) | 🟢 `apply_stock_movement` |
| R-INV-03 | Valorisation : entrée au coût d'achat, sortie au CMP ou FIFO selon paramètre | 🟡 entrée ✅, sortie de livraison au coût 0 |
| R-INV-04 | Chaque mouvement valorisé produit une écriture par rôles | 🔴 |

## R-TRE — Trésorerie

| Id | Règle | État |
|---|---|---|
| R-TRE-01 | Chaque règlement indique le compte bancaire ou la caisse utilisés | ⚪ |
| R-TRE-02 | Le solde d'un compte bancaire découle des mouvements, pas d'une saisie | 🟡 `bank_accounts.balance` modifiable par la RLS (non prouvé dans l'essai faute de compte) |
| R-TRE-03 | Un rapprochement validé n'est plus modifiable | 🟡 déclencheur horodate seulement |
| R-TRE-04 | Décaissement : approbation et séparation des tâches (saisisseur ≠ approbateur ≠ payeur) | 🟡 approbation de la facture ✅, pas de lot de paiement approuvé |
