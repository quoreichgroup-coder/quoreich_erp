# 02 — Analyse des écarts fonctionnels

Gravité : **Critique** (fausse les comptes, ouvre une faille ou bloque un processus légal) · **Haute** · **Moyenne** · **Faible**. Priorité : P0 → P3 (voir 09). Preuves : [Sn] = sonde d'écriture annulée (README), [Code] = lecture de la fonction en base, [IT]/[E2E] = test exécuté.

## Suivi des corrections

| Lot | Date | Écarts fermés | Preuves | Reste dans le périmètre |
|---|---|---|---|---|
| V42 — Ventes et clients (sécurisation) | 14 nov. 2026 | **G-01** (paiement inter-sociétés), **G-02** (paiement modifiable / supprimable → annulation par contre-passation), **G-03** (facture client émise figée), **G-06** (livraison : stock une fois, au CMP), **G-07** (facture issue de livraison en brouillon avec lignes, numéro légal à l'émission) ; G-23 partiel (échéance selon conditions du client pour les factures issues de livraison) | `VentesClientsSecurisationIT`, sondes S1, S3, S4, S12, S13 refusées ; parcours 40-clients, 60-crm-ventes, sur site ; Java 132, nuage 11/11, sur site 2/2 | G-12 avoirs, G-14 acomptes, G-23 (saisie manuelle), G-24 crédit, TVA / remise par ligne sur devis et commandes (R-O2C-06), validité du devis (R-O2C-02), lettrage G-15 |
| V43 — Ventes : pièces commerciales complètes | 14 nov. 2026 | **R-O2C-06** (remise et code TVA par ligne de devis, commande, livraison ; HT / TVA / TTC calculés par la base ; repris jusqu'à la facture brouillon — reste de G-07 fermé), **R-O2C-02** (devis expiré non convertible), **G-24** (limite de crédit bloquante, levée par `sales.credit_override` avec motif tracé ; une commande se confirme une fois, depuis le brouillon, avec au moins une ligne), **G-23** (échéance de la facture saisie = conditions du client) | `VentesPiecesCompletesIT` ; parcours 60-crm-ventes (devis à deux lignes avec remise) ; Java 136, nuage 11/11, sur site 2/2 | G-12 avoirs (V44), G-14 acomptes et G-15 lettrage (V45) ; l'exposition crédit ne compte que les factures émises non soldées (pas encore les commandes confirmées non facturées) |

## P0 — Sécurité, intégrité comptable et des données

| # | Module | Processus | Existant | Problème | Impact métier | Gravité | Recommandation | Prio |
|---|---|---|---|---|---|---|---|---|
| G-01 | Trésorerie / AR / AP | Règlement | `payments` : politique FOR ALL par société, `guard_ap_payment`, `recompute_*` SECURITY DEFINER | Aucun contrôle que la facture citée appartient à la société du paiement. Un lecteur de A paie une facture de B : la facture de B passe « partiellement payée », une écriture est créée dans A [S13] | Fuite et altération **entre sociétés** ; comptes de B faussés par un tiers | Critique | Retirer les écritures directes sur `payments` (tout passe par `record_settlement`) ; déclencheur de garde : facture de la même société, même tiers | P0 |
| G-02 | Trésorerie / AR / AP | Règlement | idem | Un lecteur supprime ou modifie un paiement [S3, S4] ; `on_ap_payment_recorded` ne réagit qu'à l'INSERT : l'écriture reste, la facture redevient due | Encours client/fournisseur ≠ grand livre ≠ banque ; fraude possible | Critique | Paiement immuable ; annulation = contre-passation motivée et habilitée | P0 |
| G-03 | AR | Facturation | `validate_ar_invoice` recalcule le total, aucune garde de cycle de vie | Un lecteur modifie le montant / l'échéance d'une facture émise [S1] ou la passe « annulée » [S12] ; l'écriture VT reste | Chiffre d'affaires, TVA collectée et créance divergents ; facture légale altérée | Critique | Garde de cycle de vie AR (comme V41 pour AP) ; annulation par avoir | P0 |
| G-04 | GL | Piste d'audit | `gl_audit_logs` politique FOR ALL | Un lecteur efface la piste d'audit [S6] ; chaînage MD5 tronqué à 8 caractères, sans vérification | Preuve d'intégrité inexistante (AUDCIF art. 19 : traçabilité, intangibilité) | Critique | Lecture seule pour tous, écriture par déclencheur uniquement ; SHA-256 + fonction de vérification | P0 |
| G-05 | Stock | Mouvements | `items`, `stock_movements` FOR ALL | Un lecteur fixe la quantité et le coût moyen [S14] ou crée un mouvement « posted » [S18] | Valorisation du stock et marge fausses ; vol masquable | Critique | Écritures directes refusées ; mouvements uniquement par fonctions habilitées (`inventory.*`) | P0 |
| G-06 | Ventes / Stock | Livraison | `post_delivery` | Décrémente `items.quantity_on_hand` **et** insère un mouvement « posted » que `apply_stock_movement` décrémente à nouveau ; coût 0 → ni FIFO consommé correctement ni coût des ventes [Code] | Stock sous-évalué du double des livraisons ; marge brute fausse | Critique | Ne garder que le mouvement, valorisé au CMP / FIFO ; écriture coût des ventes par rôle | P0 |
| G-07 | Ventes / AR | Facture issue de livraison | `invoice_from_delivery`, `auto_invoice_on_delivery` | TVA = 0, sans lignes, numéro `INV-AAAA-` + aléatoire (contourne la numérotation légale, collisions possibles), date du jour [Code] | **Facture fiscalement non conforme**, TVA collectée non déclarée ; échec aléatoire de la livraison | Critique | Créer la facture en brouillon avec les lignes et codes TVA de la commande, numéro définitif à l'émission (V22) | P0 |
| G-08 | Budget | Engagement | `commit_budget_on_po` | Ajoute le total de la commande à `actual_amount` (réalisé), deux fois (approuvée puis commandée), jamais libéré, sur le premier budget approuvé trouvé (`LIMIT 1`), sans département [Code] | Budget / réel faux ; décisions sur des chiffres faux | Critique | Séparer engagé / réalisé ; engagement à l'approbation, consommation à la facture, libération à l'annulation / clôture | P0 |
| G-09 | Budget | Approbation | `budgets` FOR ALL | Un lecteur crée un budget directement « approuvé » [S15] | Contournement du circuit budgétaire | Haute | Statut par fonction habilitée, séparation des tâches | P0 |
| G-10 | GL | Plan comptable | `gl_accounts` FOR ALL | Un lecteur crée / modifie des comptes [S7] | Altération du plan comptable | Haute | Écriture réservée à l'administrateur / comptable | P0 |
| G-11 | Immobilisations | Dotations, cessions | `post_monthly_depreciation(_tenant_id, …)`, `post_asset_disposal(_asset_id, …)` exécutables par tout utilisateur connecté | Aucune vérification de société ni de droit (le tenant est un paramètre) ; latent aujourd'hui car les fonctions échouent (voir G-20) | Une fois « réparées » telles quelles : écriture dans une autre société | Critique (latent) | Tenant résolu côté serveur, droit `assets.*` ; à corriger **avant** G-20 | P0 |

## P1 — Fonctions métier indispensables

| # | Module | Processus | Existant | Problème | Impact | Gravité | Recommandation | Prio |
|---|---|---|---|---|---|---|---|---|
| G-12 | AR | Avoir client | ⚪ | Pas d'avoir ; seule « annulation » = changement de statut | Impossible de corriger légalement une facture émise | Critique | Pièce « avoir » liée à la facture, numérotée, comptabilisée en miroir, imputable au règlement | P1 |
| G-13 | AP | Avoir fournisseur, retour | ⚪ | Ni avoir ni retour de marchandise | Litiges fournisseurs non traçables ; stock et 401 faux | Haute | Avoir AP lié à la facture ; retour lié à la réception (mouvement −, quantité reçue réduite) | P1 |
| G-14 | AR / AP | Acomptes | ⚪ ; `record_settlement` exige l'imputation totale | Pas d'acompte ni de règlement « en compte » | Pratique courante en Afrique de l'Ouest (acompte à la commande) impossible | Haute | Acompte sur compte 4191 / 4091 🧮, imputation ultérieure | P1 |
| G-15 | GL | Lettrage | ⚪ | Aucun lettrage des comptes de tiers | Balance âgée et rapprochement tiers ↔ GL non démontrables | Haute | Lettrage facture ↔ règlement automatique (V36 le permet) + manuel | P1 |
| G-16 | Trésorerie | Règlements ↔ banque | `payments` sans compte bancaire ; rôle `BANK` unique | Le paiement ne dit pas sur quel compte il passe ; espèces passées en banque ; aucun mouvement bancaire créé | Rapprochement bancaire impossible pour les règlements ; caisse inexistante | Haute | `payments.bank_account_id` obligatoire, compte GL du compte bancaire (521x / 571) | P1 |
| G-17 | AP | Facture à lignes | En-tête seul | Pas de TVA par ligne, de 3 voies ligne à ligne, de TVA non récupérable | Rapprochement global seulement ; TVA déductible approximative | Haute | Lignes AP (comme AR V21) rattachées aux lignes de commande / réception | P1 |
| G-18 | Achats / GL | Réception | Mouvement de stock seulement | Pas d'écriture « factures non parvenues » | Charges de la période sous-évaluées à la clôture | Haute 🧮 | Rôle `GRNI` (408) ; écriture à la réception soldée par la facture | P1 |
| G-19 | Stock / GL | Comptabilisation du stock | `on_stock_movement_je` : 3100 / 6010 / 4010 / 6580 codés en dur ; sortie silencieuse si absent ; réception créditée au **fournisseur** (4010) | Le jour où le compte 3100 existe, chaque réception crédite 401 en plus de la facture → **dette fournisseur comptée deux fois** | Bilan faux ; latent aujourd'hui (aucune société n'a 3100) | Critique (latent) | Rôles `INVENTORY`, `COGS`, `GRNI`, `STOCK_VARIANCE` ; refus QG001 si manquant | P1 |
| G-20 | Immobilisations | Dotations, cessions | Fonctions écrivant `journal_entries.reference` et `journal_lines.journal_entry_id` (colonnes inexistantes), en-tête inséré « posted » sans lignes | Impossible d'amortir ou de céder | Résultat et bilan faux dès qu'une immobilisation existe | Haute | Réécrire par rôles (68x / 28x), après G-11 | P1 |
| G-21 | GL | États financiers | Bilan / résultat / SIG calculés par type de compte dans le navigateur | Pas de format SYSCOHADA (bilan, compte de résultat, TAFIRE / tableau des flux, notes annexes) ; résultat de l'exercice non intégré au passif à vérifier | États non déposables | Haute 🧮 | Tables de correspondance comptes → postes SYSCOHADA (données, par référentiel) | P1 |
| G-22 | GL | Clôture d'exercice | Calendrier V33 | Pas de report à nouveau, de détermination du résultat, d'à-nouveaux | Exercice suivant sans bilan d'ouverture | Haute | Fonction de clôture : résultat → 13, à-nouveaux classes 1–5 | P1 |
| G-23 | AR | Conditions de paiement, échéance | `ar_payment_terms` sans usage ; échéance +30 j | L'échéance ne découle pas des conditions du client | Balance âgée et relances faussées | Moyenne | Échéance calculée depuis les conditions du tiers, modifiable avec trace | P1 |
| G-24 | Ventes | Contrôle de crédit | `check_customer_credit_on_so` notifie seulement | Commande confirmée au-delà de la limite | Risque client non maîtrisé | Moyenne | Blocage paramétrable + levée habilitée | P1 |
| G-25 | Tous | Multi-devise | `currency` sur tenants / bank_accounts seulement | Factures, commandes et paiements sans devise ni taux | Achats à l'import (EUR, USD) impossibles à comptabiliser correctement | Haute | Devise + taux sur les pièces, écarts de change 676 / 776 🧮 | P1 |
| G-26 | Impression | Pièces officielles | Export CSV des listes | Pas de facture imprimable / PDF conforme (mentions obligatoires : IFU, RCCM, régime fiscal, numéro) | Factures non remises au client depuis l'ERP | Haute | Lot 6 (modèles versionnés, PDF archivé) — à avancer pour la facture client | P1 |
| G-27 | Paramétrage | ROXGOLD SANGO | Rôles : `VAT_OUTPUT` → 4310, `SALES_REVENUE` → 4000 | En SYSCOHADA, 431 = Sécurité sociale, 4 = comptes de tiers ; ventes attendues en 70x, TVA collectée en 443x | TVA et chiffre d'affaires dans de mauvais comptes | Haute 🧮 | Décision de l'expert-comptable, puis reclassement par OD | P1 |
| G-28 | Paie | Comptabilisation | Comptes 6610 / 6630 / 4210 / 4310 / 4470 et taux patronal 16,4 % codés en dur | Non paramétrable par pays (CNSS Burkina, CNPS Côte d'Ivoire, IPRES Sénégal…) | Charges sociales fausses hors pays d'origine | Haute 🧮 | Rôles de comptabilisation paie + barèmes par pays (données) | P1 |

## P2 — Améliorations fonctionnelles

| # | Module | Problème | Recommandation |
|---|---|---|---|
| G-29 | Achats | Pas de demande de prix (RFQ) ni de comparatif d'offres | RFQ multi-fournisseurs → comparatif → commande |
| G-30 | Achats | Réception de services non distinguée | Réception « service » (quantité ou pourcentage d'avancement) sans mouvement de stock |
| G-31 | AP | Retenues à la source paramétrées (`ap_withholding_rates`) non appliquées 🧮 | Appliquer au règlement (BIC, BNC selon pays) |
| G-32 | AR | Relances (`ar_dunning_rules`) sans traitement | Traitement de relance avec historique, sans doublon |
| G-33 | Tiers | Coordonnées bancaires fournisseur absentes ; un seul identifiant fiscal | IBAN / RIB, IFU, RCCM, régime fiscal |
| G-34 | Ventes | `on_so_confirmed` vide ; `confirm_so` ne vérifie pas le statut courant | Réservation de stock et contrôle des transitions |
| G-35 | Toutes | Pièces jointes justificatives (`documents`) absentes | Stockage des justificatifs (facture fournisseur scannée) |
| G-36 | Écrans | ~15 pages de reporting / contrôle avec montants codés en dur (BudgetForecast : 51, Reports : 20…) | Données réelles ou « non disponible » (Lot 3 étape 8 étendue) |
| G-37 | Notes de frais | `expense_reports` FOR ALL : approbation par n'importe quel membre | Cycle de vie et séparation des tâches comme V39 |
| G-38 | Trésorerie | `bank_accounts`, `bank_transactions`, `bank_reconciliations` FOR ALL | Droits `treasury.*` et rapprochement validé non modifiable |

## P3 — Optimisations

| # | Problème | Recommandation |
|---|---|---|
| G-39 | API Java limitée à AR : sur site incomplet | Tranches AP, achats, stock, GL (plan de bascule, Lots 3–5) |
| G-40 | Libellés anglais restants (« New PO », « Approve », statuts bruts `pending_approval`) | Passe de traduction et composant de statut unique |
| G-41 | Pas de tests de concurrence (double clic, deux onglets) | Clé d'idempotence par opération, tests de concurrence |
