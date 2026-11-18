# 13 — Trésorerie reliée aux règlements (lot T1, V70)

Audit de l'existant du 14 nov. 2026, comparé à SAP, Sage et au SYSCOHADA révisé, puis livraison.
Écarts traités : **G-16** (règlements ↔ banque) et **G-38** (tables de trésorerie ouvertes à tout
membre). Étape 2 de la priorité P1 de la feuille de route (09).

## 1. Constats

| # | Constat | Preuve | Conséquence |
|---|---|---|---|
| T-1 | Un règlement ne dit pas sur quel compte il passe | `payments` sans compte ; `on_ap_payment_recorded` impute le rôle `BANK` unique, espèces et mobile money compris | Caisse et mobile money confondus avec la banque ; soldes par compte impossibles |
| T-2 | Aucun mouvement de trésorerie n'est créé par un règlement | 0 ligne de `bank_transactions` reliée à un paiement (copie réelle et nuage) | Rapprochement bancaire impossible pour les règlements de l'ERP |
| T-3 | Le solde d'un compte bancaire est saisi | `bank_accounts.balance` libre | Solde du cockpit CFO non démontrable |
| T-4 | Un mouvement saisi n'a pas d'écriture | `useCreateBankTransaction` : insertion directe | Trésorerie et grand livre divergent |
| T-5 | Tables de banque en `FOR ALL` | `bank_accounts`, `bank_transactions`, `bank_statements`, `bank_statement_lines`, `bank_reconciliations`, `treasury_settings` | Un lecteur pouvait créer un mouvement, modifier un relevé ou dévalider un rapprochement |
| T-6 | Écrans de démonstration | Données de base et Transactions de la trésorerie : tableaux codés en dur, en anglais, aucun moyen de créer un compte | — |

## 2. Références

* **SAP** : un compte général par compte bancaire (« house bank » / ID de compte), journal de caisse (FBCJ),
  relevé électronique rapproché aux postes du compte ; virements internes par compte de transit.
* **Sage 100 / 300** : un journal de trésorerie par compte (banque ou caisse), règlement saisi sur ce journal,
  rapprochement par compte.
* **SYSCOHADA révisé (2017)** : 52 banques, 57 caisse, **55 instruments de monnaie électronique** (552 :
  téléphone portable — Orange Money, Wave, Moov…), 585 virements de fonds.

## 3. Livré (V70)

* **Comptes de trésorerie** typés (banque, caisse, mobile money), chacun relié à **son** compte général
  (classe contrôlée par le référentiel : 52 / 57 / 55 pour SYSCOHADA), solde d'ouverture daté, **solde calculé**
  (ouverture + mouvements, jamais saisi), un compte par défaut par type ; un compte mouvementé a son compte
  comptable, sa devise et son ouverture figés ; il ne se supprime pas (désactivation).
* **Règlements, acomptes, remboursements** : compte choisi, sinon compte par défaut du type du mode de paiement ;
  l'écriture passe sur son compte général et le **mouvement de trésorerie** est créé (annulation : mouvement
  inverse sur le même compte). Sans compte de trésorerie : rôle du mode (**CASH** 571, **MOBILE_MONEY** 552, à
  défaut BANK) — comportement antérieur. Paramètre « compte de trésorerie obligatoire » (désactivé par défaut).
* **Mouvement manuel** (frais, agios, intérêts, apport) et **virement entre comptes** de la société (même devise) :
  écriture au journal BQ et mouvement(s).
* **Sécurité** : écriture des comptes = `treasury.manage_accounts` ; mouvements uniquement par fonctions ;
  relevés = `treasury.import_statement` (montant, date, libellé figés) ; rapprochement = `treasury.match`,
  validation = `treasury.validate_recon`, rapprochement validé figé ; paramètres = `treasury.settings` (nouveau).
* **Écrans** : Trésorerie → Données de base (comptes réels), Transactions (mouvements réels, mouvement manuel,
  virement, exports Excel / CSV), Paramètres (compte obligatoire ; comptabilisation par rôles) ; « Compte de
  trésorerie » dans l'encaissement / règlement par tiers, l'acompte et le remboursement.

## 4. Restant (lots suivants)

* Formats bancaires structurés MT940 / CAMT.053 / CFONB (le lot T2 lit les exports Excel et CSV des banques).
* Change : comptes en devise et écarts de change (lot I1, G-46).
* Écrans de trésorerie encore fictifs : instruments financiers, contreparties, prévisions par défaut (UX-1).

## 5. Lot T2 — relevés et rapprochement bancaire (V71)

Constats : tables de relevés et de rapprochement présentes mais aucun écran d'import ni de rapprochement
(onglet « Bank Reconciliation » de démonstration) ; aucun contrôle d'équilibre ni de continuité des relevés ;
validation d'un rapprochement sans contrôle ; un même mouvement rapprochable de deux lignes.

Livré :

* **Import du relevé** de la banque (Excel ou CSV : colonnes Date, Libellé, Montant ou Débit / Crédit, Référence
  reconnues ; montants « 1 234,50 », dates jj/mm/aaaa ou série Excel ; lignes de solde ignorées) ; la base refuse
  un relevé déséquilibré (solde initial + mouvements ≠ solde final), non continu avec le précédent (paramètre
  `statement_continuity_check`), chevauchant une période déjà importée, ou des lignes déjà importées.
* **Rapprochement automatique** sans ambiguïté (un seul mouvement possible : montant à la tolérance près, date dans
  la fenêtre paramétrée, même référence si les deux en ont une), puis **manuel** (propositions, tous les mouvements
  non rapprochés), annulation ; un mouvement ne se rapproche que d'une ligne.
* **Ligne inconnue de l'ERP** (frais, agios, SMS, intérêts) : comptabilisée en un clic (écriture BQ, mouvement
  créé et rapproché).
* **État de rapprochement** à la date du dernier relevé : solde du relevé + encaissements en suspens − décaissements
  en suspens = solde comptable ; validation (droit `treasury.validate_recon`) refusée tant qu'une ligne du relevé
  est sans contrepartie ou que l'égalité ne tient pas ; rapprochement validé figé (V70) ; relevé annulable tant
  qu'aucune ligne n'est rapprochée.
* Écran : Trésorerie → Contrôle → « Rapprochement bancaire » (`BankReconciliation.tsx`).

Pour rejouer les contrôles connectés des droits et des exports, lancer
`npx playwright test --config playwright.treasury-readonly.config.ts`. La suite
vérifie les comptes réservés à **E2E QUOREICH (société de test)** et écarte les
scénarios qui insèrent des pièces. Les cas qui demandent un journal d’audit
alimenté sont vérifiables sur des données simulées avec
`npm run test:e2e -- tests/e2e/treasury-exports.spec.ts`.
