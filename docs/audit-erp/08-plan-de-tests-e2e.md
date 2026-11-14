# 08 — Plan de tests de bout en bout

Règle : **aucun test n'est déclaré réussi sans preuve d'exécution** (rapport Playwright, sortie Maven, requête de vérification). Colonne « Preuve aujourd'hui » : ce qui a réellement été exécuté au 14 novembre 2026.

## 1. Existant exécuté

| Suite | Commande | Résultat (14 nov. 2026) |
|---|---|---|
| Intégration Java (vraie base) | `./mvnw verify` | 128 tests verts |
| Parcours nuage (Supabase, société de test, données conservées) | `npm run test:e2e:parcours` | 13/13, zéro incident serveur ou navigateur |
| Parcours sur site (front → API Java → PostgreSQL local) | `npm run test:e2e:sur-site` | 2/2, données présentes en local et absentes de Supabase |
| Unitaires front | `npm test` | 64 fichiers, 450 tests |

## 2. Scénarios

### E2E-O2C — Vente → encaissement

Données : société « E2E QUOREICH (société de test) », référentiel SYSCOHADA appliqué, code TVA 18 % 🧮, client `E2E-<run> Client O2C`, article stocké avec 10 unités à 5 000 XOF.

| # | Étape | Résultat attendu | Assertion technique | Preuve aujourd'hui |
|---|---|---|---|---|
| 1 | Créer le client | Fiche visible | ligne `customers` de la société | ✅ 10-tiers |
| 2 | Devis 2 lignes, remise 10 % sur une ligne | Pied HT / TVA / TTC calculés | `quotations.total` = Σ lignes ; numéro `QT-AAAA-####` | 🟡 60-crm-ventes (devis depuis opportunité) |
| 3 | Valider puis convertir en commande | Commande liée | `sales_orders.quotation_id` ; un 2e appel renvoie la même commande | 🟡 |
| 4 | Livrer 6 sur 10 | Commande « partiellement livrée » ; stock −6 **une fois**, au CMP | `items.quantity_on_hand` = 4 ; un seul mouvement, `unit_cost` = CMP | ❌ **échouera aujourd'hui (G-06)** → à écrire en `test.fail` |
| 5 | Facturer la livraison | Facture brouillon avec lignes et TVA 18 %, numéro définitif à l'émission | `ar_invoices.tax_amount` > 0 ; `invoice_number` ~ série | ❌ **échouera (G-07)** |
| 6 | Écriture | 411 TTC / 701 HT / 4431 TVA | lignes de `journal_entries` (VT) | ✅ pour une facture saisie (40-clients) |
| 7 | Encaissement partiel puis solde | « partiellement payée » puis « payée » ; écritures BQ datées | `amount_paid`, deux écritures 521 / 411 | ✅ 40-clients |
| 8 | Lettrage et balance âgée | Facture lettrée, absente de la balance âgée | — | ⚪ lettrage absent |
| 9 | Avoir partiel | Avoir numéroté, écriture inverse | — | ⚪ |

### E2E-P2P — Achat → paiement

| # | Étape | Résultat attendu | Assertion | Preuve aujourd'hui |
|---|---|---|---|---|
| 1 | Demande multiligne, soumise | « en attente d'approbation » ; l'auteur ne voit pas « Approuver » | file `procurement_approvals` | ✅ 20-achats |
| 2 | Approbation par l'approbateur | approuvée | niveau L1 approuvé par un tiers | ✅ |
| 3 | Conversion en commande, approbation | commande approuvée | `convert_pr_to_po` | ✅ |
| 4 | Réception partielle 6 / 10 ; sur-réception refusée | « partiellement reçue » ; stock +6 au coût de la commande | QG004 sur dépassement | ✅ 20-achats |
| 5 | Facture au-delà du reçu | Refus 3 voies QG008 | toast « Rapprochement à 3 voies » | ✅ 30-fournisseurs |
| 6 | Facture corrigée, approuvée par un tiers | 601 / 4452 / 401 | aperçu d'écriture | ✅ 30-fournisseurs |
| 7 | Paiement | facture soldée, 401 / 521 | bouton « Pay » disparu | ✅ |
| 8 | Budget | engagement à l'approbation, réalisé à la facture | `budget_lines` | ❌ **échouera (G-08)** |
| 9 | Écriture de réception (FNP) | 31x / 408 | — | ⚪ |
| 10 | Avoir / retour fournisseur | — | — | ⚪ |

### E2E-R2R — Comptabilité générale

| # | Étape | Attendu | Preuve |
|---|---|---|---|
| 1 | Écriture manuelle déséquilibrée | refus | ✅ IT |
| 2 | Écriture comptabilisée modifiée | refus (intangible) | ✅ JournauxEtLotsIT |
| 3 | Contre-passation | écriture inverse, motif | ✅ IT |
| 4 | Journaux, pièces, lots à l'écran | `AC-…`, `BQ-…`, `LOT-AC-…` | ✅ 50-comptabilite |
| 5 | Période close | refus QG003 | ✅ CalendrierFiscalIT |
| 6 | Rapprochement AR ↔ GL, AP ↔ GL | écart = 0 | ⚪ |
| 7 | Clôture d'exercice | résultat en 13, à-nouveaux | ⚪ |

### E2E-SEC — Sécurité (nouvelle suite, à créer en P0)

Rejouer chaque sonde de l'audit **en tant que « Lecteur »**, dans un IT Java (`SondesLecteurIT`) et dans un parcours nuage. Chaque ligne doit être **refusée** ; aujourd'hui elles réussissent.

| Sonde | Action du lecteur | Attendu | Aujourd'hui |
|---|---|---|---|
| S1 | Modifier le montant / l'échéance d'une facture émise | refus | ❌ accepté (5 factures) |
| S3 | Supprimer un paiement | refus | ❌ accepté |
| S4 | Modifier le montant d'un paiement | refus | ❌ accepté (bloqué seulement si > total) |
| S6 | Effacer `gl_audit_logs` | refus | ❌ accepté (20 lignes) |
| S7 | Créer un compte GL | refus | ❌ accepté |
| S12 | Annuler une facture émise | refus (avoir obligatoire) | ❌ accepté |
| S13 | Payer une facture **d'une autre société** | refus | ❌ accepté, facture de l'autre société modifiée |
| S14 | Modifier quantité et coût moyen d'un article | refus | ❌ accepté |
| S15 | Créer un budget « approuvé » | refus | ❌ accepté |
| S18 | Créer un mouvement de stock « posted » | refus | ❌ accepté |
| — | Appeler `post_asset_disposal` sur l'immobilisation d'une autre société | refus | ❌ aucun contrôle (échoue aujourd'hui pour une autre raison) |
| S11 | Supprimer une écriture | refus | ✅ refusé (politique réservée à l'administrateur) |
| S9, S10 | Modifier une facture AP approuvée ; encaisser une facture ouverte de sa société | refus / droit requis | ⚪ **non concluant** : la société sondée n'avait aucune pièce dans l'état voulu (0 ligne). S9 est couvert par `guard_ap_invoice_lifecycle` (IT V41) ; S10 reste à rejouer |

### E2E-SUR-SITE

Étendre le parcours sur site à chaque tranche portée par l'API (AP, achats, stock, GL), avec la même assertion : aucune écriture de ce périmètre ne part vers Supabase.

## 3. Règles d'exécution

- Les défauts connus s'écrivent en `test.fail` avec la référence de l'écart (G-xx) : le test devient rouge le jour où le défaut est corrigé sans que le test soit mis à jour.
- Données préfixées `E2E-<run>` et conservées (choix du propriétaire).
- Les sondes de sécurité ne s'exécutent **jamais** sur la base de production : copie locale ou société de test, transaction annulée.
