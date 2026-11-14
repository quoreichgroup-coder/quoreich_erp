# 09 — Feuille de route priorisée et plan d'amélioration

Contraintes respectées par ce plan : pas de réécriture ; fonctionnalités opérationnelles préservées ; réutilisation des composants et du motif V39 / V41 ; aucune donnée de production modifiée pendant l'audit ; **aucune migration destructive** (les gardes refusent, elles ne suppriment rien ; les corrections d'historique passent par des scripts en simulation par défaut) ; aucune nouvelle dépendance ; chaque étape documente son impact ; **rien n'est lancé sans validation du propriétaire**.

## P0 — Sécurité, comptabilité, intégrité (proposé : lot court « Sécurisation », V42–V44)

| Étape | Écarts | Contenu | Impact sur l'existant | Tests |
|---|---|---|---|---|
| **V42 — Règlements et piste d'audit** | G-01, G-02, G-04 | Garde sur `payments` : écriture directe refusée pour `authenticated` / `qerp_api` (tout passe par `record_settlement`, déjà utilisé par les écrans) ; facture de la même société et du même tiers ; paiement immuable ; fonction `reverse_settlement(payment, motif)` (contre-passation habilitée) ; `gl_audit_logs` en lecture seule | L'endpoint Java d'encaissement AR (Lot 2) appelle déjà une fonction contrôlée — à vérifier ; écrans inchangés | `SondesLecteurIT` S3, S4, S6, S13 ; parcours 30 / 40 |
| **V43 — Cycle de vie de la facture client** | G-03 | Garde comme V41 : facture émise figée (en-tête et lignes), statut par fonctions ; « annuler » devient interdit tant que l'avoir n'existe pas (P1), sauf brouillon supprimable | Bouton d'annulation retiré de l'écran AR ; API Java AR : vérifier qu'elle n'écrit que des brouillons | S1, S12, S5 (suppression d'une facture émise sans règlement : aujourd'hui seule la clé étrangère des paiements l'empêche) ; IT Lot 2 rejoués |
| **V44 — Stock, ventes, budget, référentiels** | G-05, G-06, G-07, G-08, G-09, G-10, G-11 | `items` / `stock_movements` : écriture directe refusée ; `post_delivery` : un seul mouvement au CMP ; facture issue de livraison en **brouillon** avec lignes et codes TVA de la commande, numéro définitif à l'émission ; `commit_budget_on_po` désactivé tant que l'engagement n'est pas refait (P1) ; budgets par fonction ; `gl_accounts` réservé admin / comptable ; immobilisations : `post_*` révoqués pour `authenticated` jusqu'à leur réécriture | `auto_invoice_on_delivery` crée un brouillon au lieu d'une facture émise (changement de comportement visible) | S7, S14, S15, S18 ; parcours 60 étendu (livraison) |
| Historique | G-06, G-08 | Scripts en simulation par défaut : recalcul du stock des articles livrés, remise à zéro du « réalisé » budgétaire issu des commandes ; rapport des factures issues de livraison sans TVA | Aucun sans votre accord et celui de l'expert-comptable | — |

## P1 — Fonctions métier indispensables

Ordre proposé, chaque étape avec IT + parcours :

1. **Avoirs clients et fournisseurs** (G-12, G-13) puis **annulation par avoir** (complète V43).
2. **Règlements reliés à la trésorerie** : compte bancaire / caisse obligatoire, rôle `CASH` (G-16) ; **acomptes** (G-14) ; **lettrage** automatique et manuel (G-15) ; rapprochements AR ↔ GL, AP ↔ GL (05 §4).
3. **Facture fournisseur à lignes** et 3 voies ligne à ligne (G-17) ; **écriture de réception** sur 408 (G-18) ; **stock comptabilisé par rôles** (G-19) ; retour fournisseur.
4. **Engagement budgétaire** refait : engagé / réalisé / disponible, contrôle avant approbation, levée habilitée (G-08 suite).
5. **Immobilisations** réécrites par rôles (G-20) ; **paie** par rôles et barèmes par pays (G-28 🧮).
6. **États financiers SYSCOHADA** (G-21 🧮) et **clôture d'exercice** (G-22).
7. **Multi-devise** (G-25) ; échéance depuis les conditions de paiement (G-23) ; blocage de crédit (G-24) ; contraintes `CHECK` de statut.
8. **Impression de la facture client** avancée depuis le Lot 6 (G-26).
9. Données fictives retirées des écrans (UX-1).

## P2 — Améliorations

RFQ et comparatif (G-29) ; réception de services (G-30) ; retenues à la source (G-31 🧮) ; relances (G-32) ; coordonnées bancaires et identifiants fiscaux des tiers (G-33) ; réservation de stock (G-34) ; pièces jointes (G-35) ; cycle de vie des notes de frais et droits trésorerie (G-37, G-38) ; `DocumentPage`, fil de la pièce, libellés français, `ConfirmDialog` (UX-2 à UX-5).

## P3 — Optimisations

Tranches API Java AP / achats / stock / GL pour un sur site complet (G-39) ; idempotence et tests de concurrence (G-41) ; accessibilité et responsive (UX-8, UX-9) ; sauvegarde / restauration testée (T-13).

## Stocks, achats et achats internationaux (ajout du 14 nov. 2026)

Analyse complète et justification : [11-stocks-achats-international.md](11-stocks-achats-international.md).

| Lot | Écarts | Contenu | Priorité |
|---|---|---|---|
| S1 — fait (V53) | S-stocks | Écritures directes fermées, ajustement motivé, transfert limité à la société, écrans réels | ✅ |
| S2 — fait (V54) | G-42 | Alerte au point de commande | ✅ |
| R1 — fait (V54) | G-42, G-43 | Règles par article × dépôt, catalogue fournisseur, stock prévisionnel, propositions → demandes d'achat | ✅ |
| A1 — fait (V56) | G-45, G-33 | Fiche fournisseur complète, double contrôle bancaire, dates prévues, accusé de réception, retards | ✅ |
| I1 | G-46 | Devises, écarts de change, avance fournisseur | P1 (sociétés importatrices) |
| I2 | G-47 | Dossier d'import, frais d'approche répartis dans le coût du stock, douane UEMOA | P1 (sociétés importatrices) |
| S3 | G-44 | Campagnes d'inventaire, gel, aveugle, tolérance, tournant ABC | P2 (P1 avant la clôture annuelle) |
| A2 | G-29 | Demandes de prix et comparatif | P2 |
| I3 | G-48 | En-cours de route, suivi logistique | P2 |
| A3 | G-50 | Contrats-cadres, évaluation fournisseurs | P3 |

## Paramétrage (règle du propriétaire, 14 nov. 2026 : « tout doit être paramétrable »)

Méthode (appliquée à V57 pour les achats) : chaque règle = paramètre par société (valeur par défaut = comportement livré, désactivable) lu par la base, et chaque action = droit du catalogue attribuable à tout rôle. Ordre proposé pour résorber **G-51** : ventes et comptes clients (cycle de la facture, crédit), stocks (rôles des modules → catalogue), trésorerie, comptabilité (écrans de comptabilisation statiques → rôles de comptabilisation), RH, immobilisations, budget, CRM. Chaque nouveau lot (I1 devises, I2 import…) naît paramétrable.

## Décisions attendues de votre part

| # | Décision | Recommandation |
|---|---|---|
| D1 | Lancer le lot de sécurisation P0 (V42–V44) **avant** de poursuivre le Lot 3 | Oui : ce sont des failles exploitables par n'importe quel salarié connecté, et une écriture entre sociétés |
| D2 | Facture issue de livraison : brouillon à compléter, ou émission automatique avec la TVA de la commande | Brouillon (le comptable valide), comme SAP VF01 en facturation collective contrôlée |
| D3 | Budget : désactiver l'imputation fausse dès V44 en attendant le module d'engagement | Oui (chiffres faux pires qu'absents) |
| D4 | ROXGOLD SANGO : reclassement 4000 → 70x et 4310 → 443x | À trancher par l'expert-comptable, puis OD de reclassement |
| D5 | Paie : comptes et taux à confirmer par pays | Expert-comptable / fiscaliste local |

## Points à valider par un expert-comptable ou fiscaliste 🧮

Taux de TVA par pays (18 % UEMOA courant, à confirmer par pays et par produit) ; comptes 408, 4091, 4191, 571, 676 / 776 ; méthode d'inventaire (permanent ou intermittent, 6031) ; retenues à la source (BIC / BNC, taux par pays) ; charges sociales (CNSS / CNPS / IPRES, plafonds et taux) ; mentions obligatoires des factures (IFU, RCCM, régime d'imposition, centre des impôts) ; format des états financiers (système normal / allégé / minimal de trésorerie) ; durée de conservation (10 ans, AUDCIF art. 24).
