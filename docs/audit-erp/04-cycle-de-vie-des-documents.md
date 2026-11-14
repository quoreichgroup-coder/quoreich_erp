# 04 — Matrice du cycle de vie des documents

Colonnes demandées : Document | Source | Statuts | Approbation | Impact stock | Impact comptable | Pièce suivante — complétées par la numérotation, l'impression et l'état réel.

> **Constat transversal :** aucune des tables de pièces (`quotations`, `sales_orders`, `delivery_notes`, `ar_invoices`, `purchase_requisitions`, `purchase_orders`, `goods_receipts`, `ap_invoices`, `journal_entries`, `bank_reconciliations`, `budgets`) n'a de contrainte `CHECK` sur `status` : les statuts sont du texte libre. Les valeurs ci-dessous sont celles qu'emploient les fonctions et les écrans ; seules les gardes V34 / V39 / V41 (réceptions, achats, factures AP) et V38 (écritures) contrôlent réellement les transitions. Recommandation P1 : contrainte `CHECK` par table + garde de transition.

## Commercial

| Document | Source | Statuts (réels) | Approbation | Impact stock | Impact comptable | Suivant | Numéro | Impression | État |
|---|---|---|---|---|---|---|---|---|---|
| Devis | Opportunité CRM ou saisie | draft, sent, accepted, rejected, expired | ⚪ | — | — | Commande | ✅ série QT (V40) | ⚪ | 🟢 validité non contrôlée |
| Commande client | Devis (`convert_quote_to_so`) | draft, confirmed, partially_delivered, delivered | `sales.confirm` (droit, pas de circuit) | ⚪ réservation | — | Livraison | ✅ série SO | ⚪ | 🟡 crédit non bloquant |
| Bon de livraison | Commande (`post_delivery`) | draft → completed | `sales.deliver` | 🔴 −2 × quantité, coût 0 | ⚪ coût des ventes | Facture | ✅ série DN | ⚪ | 🔴 |
| Facture client | Saisie, livraison | draft (BROUILLON-x) → sent/open → partially_paid → paid ; overdue ; cancelled | ⚪ | — | 411 / 70x / 443x (V18) | Encaissement, avoir | ✅ V22 à l'émission ; 🔴 si issue de livraison | ⚪ (Lot 6) | ✅ saisie ; 🔴 cycle de vie [S1, S12] |
| Facture d'acompte | — | — | — | — | — | — | — | — | ⚪ |
| Avoir client | — | — | — | — | — | — | — | — | ⚪ |
| Reçu / encaissement | Facture(s) du client (V36) | une ligne `payments` par facture | ⚪ | — | 521 / 411 (V34, daté du paiement) | Rapprochement | ⚪ (référence libre) | ⚪ | 🟡 [S3, S4, S13] |
| Relevé de compte client | — | — | — | — | — | — | — | — | ⚪ (balance âgée seulement) |

## Achats

| Document | Source | Statuts | Approbation | Impact stock | Impact comptable | Suivant | Numéro | Impression | État |
|---|---|---|---|---|---|---|---|---|---|
| Demande d'achat | Saisie multiligne | draft → pending_approval → approved / rejected → converted ; cancelled | Niveaux L1–L3 selon seuils, séparation des tâches (V39) | — | — | Commande | 🟢 | ⚪ | ✅ |
| Demande de prix (RFQ) | — | — | — | — | — | — | — | — | ⚪ |
| Comparatif des offres | — | — | — | — | — | — | — | — | ⚪ |
| Commande fournisseur | Demande (`convert_pr_to_po`) ou directe (si permis) | draft → pending_approval → approved → partially_received → received ; rejected, cancelled | Niveaux (V39) | — | 🔴 budget « réalisé » | Réception | 🟢 séquence | ⚪ | ✅ (sauf budget) |
| Bon de réception | Commande du fournisseur choisi | pending → completed (figé) | ⚪ (droit `procurement.receive` à créer) | + quantité au coût de la commande (V34) | ⚪ GR/IR 🧮 | Facture AP | 🟢 | ⚪ | ✅ |
| Réception de services | — | — | — | — | — | — | — | — | ⚪ |
| Retour fournisseur | — | — | — | — | — | — | — | — | ⚪ |
| Facture fournisseur | Commande du même fournisseur | draft → submitted → approved (open) / rejected → partially_paid → paid | Niveaux L1–L4, séparation des tâches (V41) | — | 60x / 4452 / 401 (V37) | Paiement | Numéro fournisseur unique (V41) ; ⚪ numéro interne | ⚪ | ✅ (en-tête seul) |
| Avoir fournisseur | — | — | — | — | — | — | — | — | ⚪ |
| Ordre / lot de paiement | Factures approuvées du fournisseur (V36) | une ligne `payments` par facture | Approbation de la facture seulement | — | 401 / 521 (V34) | Rapprochement | ⚪ | ⚪ | 🟡 [S3, S4] |

## Finance

| Document | Source | Statuts | Approbation | Impact comptable | Numéro | Impression / export | État |
|---|---|---|---|---|---|---|---|
| Pièce comptable | Auxiliaires (VT, AC, BQ, PA) ou manuelle (OD) | draft → posted → reversed | Comptable / administrateur | Elle-même | ✅ `AC-2026-000001` (V38) | Export CSV ✅ | ✅ |
| Journal | `accounting_journals` | — | — | — | VT, AC, BQ, PA, OD | ✅ | ✅ |
| Lot GL | `journal_batches` | open / closed (période) | — | — | `LOT-AC-2026-11` | ✅ | ✅ |
| Grand livre, balance | Vues `gl_ledger_detail`, `gl_trial_balance` | — | — | — | — | Export CSV ✅ ; PDF ⚪ | ✅ |
| Bilan, compte de résultat, SIG | Calcul navigateur par type de compte | — | — | — | — | CSV ✅ | 🟡 pas au format SYSCOHADA 🧮 |
| Relevé bancaire | Import | imported | — | — | — | — | 🟢 |
| Rapprochement bancaire | Relevé + mouvements, `suggest_bank_matches` | draft → validated | ⚪ | Option `auto_je_on_reconciliation` | — | — | 🟡 règlements AR/AP non reliés |
| États financiers annuels (DSF) | — | — | — | — | — | — | ⚪ 🧮 |

## Cohérence entre pièces liées (traçabilité)

| Lien | En base | Contrôlé | Visible à l'écran |
|---|---|---|---|
| Devis → commande | `sales_orders.quotation_id` | ✅ unicité | 🟡 |
| Commande → livraison → facture | `delivery_notes.so_id`, `ar_invoices.so_id / dn_id` | ✅ même client (V36) | 🟡 |
| Facture → lignes de commande | ⚪ (lignes non reprises) | — | — |
| Demande → commande | `on_pr_converted_to_po` | ✅ | ✅ |
| Commande → réception → facture AP | `gr.po_id`, `ap_invoices.po_id` | ✅ même fournisseur | ✅ détail « Voir » |
| Ligne de facture AP → ligne de réception | ⚪ | — | — |
| Facture → paiements | `payments.ar_invoice_id / ap_invoice_id` | 🔴 société non vérifiée | ✅ pied « Reste à payer » |
| Pièce → écriture | `journal_entry_id` | ✅ | ✅ `JournalEntryPreview` |
| Écriture → pièce d'origine | `source` (texte) sans identifiant | ⚪ | ⚪ (pas de navigation retour) |
