# 03 — Audit fonctionnel par module

> Phase 2 de l'audit global. Statuts selon l'échelle de la demande (§6) ; preuves dans `22_EVIDENCE_REGISTER.md`.

## Règle de statut appliquée

| Niveau de preuve disponible | Statut maximal attribué |
|---|---|
| Code + migrations, sans test | IMPLEMENTED |
| Tests d'intégration Java verts en CI le 26/11/2026 (EV-11) | TESTED (technique) |
| + parcours E2E réussi à une date documentée, **non rejoué dans cet audit** | TESTED (technique) — mention « parcours : état documenté » |
| + recette métier signée par le propriétaire / expert-comptable | STABLE — **aucun module n'atteint ce niveau** |
| + exploitation (VPS, sauvegardes restaurées, supervision) | PRODUCTION READY — **aucun module** (voir 12) |

Conséquence : le meilleur statut constaté est **TESTED**. Aucun module n'est déclaré STABLE ni PRODUCTION READY.

## Synthèse

| Domaine (demande §7) | Statut | Tests d'intégration (exemples) | Parcours | Principaux manques |
|---|---|---|---|---|
| Finance (GL, auxiliaires) | TESTED | `JournauxEtLotsIT`, `ControlesGrandLivreIT`, `PisteAuditChaineeIT`, `ClotureExerciceIT`, `EtatsParRubriquesIT`, `TableauFluxTresorerieIT`, `NotesAnnexesIT`, `PlanComptableSyscohadaIT` | 50, 97, 98 | Validation des états par un expert-comptable ; G-27 (ROXGOLD) |
| Budget | TESTED | `ControleBudgetaireIT`, `BudgetPreEngagementAnalytiqueIT`, `BudgetLignesPrevisionsImportIT`, `BudgetParametresScenariosIT` | 90, 92–94 | UX-10 à confirmer |
| Trésorerie | TESTED | `TresorerieReglementsIT`, `RapprochementBancaireIT`, `ReglementsParTiersIT`, `CoursBceaoIT` | 80, 81 | Formats de relevés bancaires réels à valider par banque |
| Fiscalité | **PARTIAL** | `RetenuesALaSourceIT`, `RetenuesParametrablesIT`, codes TVA dans `LignesFactureIT` | 30 | **Aucune déclaration** (TVA, retenues télédéclarées) ; aucune facture électronique normalisée ; aucun taux légal saisi |
| Immobilisations | TESTED | `ImmobilisationsIT` | 91 | Pas de lien vers maintenance (EAM inexistant) ; réévaluation, dépréciation non vues |
| Achats | TESTED | `CycleDeVieAchatsIT`, `ReceptionsEtPaiementsIT`, `DemandesDePrixIT`, `ArticlesNonStockesIT`, `ProcessusImportSansExcelIT`, `DossiersImportFraisApprocheIT` | 10, 20, 25, 103, 105, 106 | Délégation d'approbation ; contrats-cadres, évaluation fournisseurs (G-50) |
| Stocks | TESTED | `StocksSecurisationIT`, `ComptabilisationStocksIT`, `ReapprovisionnementIT` | 70, 71 | Réservation ferme (G-34) ; lots / séries / péremption (G-49) |
| Ventes / clients / CRM | TESTED | `VentesPiecesCompletesIT`, `AvoirsClientsIT`, `AcomptesEtLettrageIT`, `RetoursClientsIT`, `DevisesVentesIT`, `ArDunningIT` | 40, 60, 61 | Relances : fonction cloud et SMTP non déployés (G-32) |
| RH | TESTED | `RhReferentielsIT`, `HrApiIT` | 95 | Import RH avec simulation ; pièces jointes sur mouvements |
| Paie | TESTED (moteur) / **BLOCKED** (usage réel) | `PaieProrataPresenceIT`, `PaieReglesVersionneesIT`, `HrApiIT` | 95 | **Aucun barème légal saisi** (CNSS, IUTS) ; déclarations sociales et fiscales absentes ; cumuls |
| Workflows | **PARTIAL** | Approbations par module : `CycleDeVieAchatsIT`, `CycleDeVieFacturesFournisseursIT`, `NotesDeFraisIT`, budget | — | `workflow_rules` éditable mais **lu par aucune fonction** (EV-12) ; **pas de délégation / suppléance** ; pas de moteur transverse |
| Reporting | TESTED (états) / PARTIAL (moteur) | `EtatsParRubriquesIT`, `TableauFluxTresorerieIT`, `DocumentsArchivesIT` | 98, 107 | Pas de générateur de rapports utilisateur ; rendu PDF cloud non configuré (lot 6) |
| Administration | TESTED | `AuthorizationsApiIT`, `RolesDesModulesIT`, `ModuleAccessIT`, `IsolationSocietesIT`, `IdentityApiIT` | 00, 01 | Effet du contrôle d'accès sur le rôle Lecteur à confirmer (EV-06) |
| Notes de frais, projets, conformité, risques | TESTED | `NotesDeFraisIT`, `ProjetsIT`, `ConformiteRisquesIT`, `ExpensesProjectsGrcApiIT` | 99–101 | — |
| EAM | NOT STARTED | — | — | Tout (voir 09) |
| Downtime Management | NOT STARTED | — | — | Tout ; D-01/D-02/D-03 non fournis |
| Production | NOT STARTED | — | — | Tout |
| Fleet Management | NOT STARTED | — | — | Tout |
| Mobile | NOT STARTED | — | — | Tout ; DEC-09 ouverte |
| Business AI | PARTIAL | `PilotageAdminApiIT.analysePlanifiee` | 102 | 2 analyses, aucun agent, aucune gouvernance IA formalisée (voir 10) |

## Fiches par module

Chaque fiche suit la grille §8 de la demande, réduite aux points où un constat existe. « — » = sans objet ou non constaté.

### F-01 Finance et comptabilité

- **Données de base** : plans multi-référentiels versionnés (SYSCOHADA, PCG), attributs de compte, comptes de regroupement, jeux de comptes par tiers / article (V60–V69, V105).
- **Transactions** : écritures manuelles (brouillon → comptabilisée), écritures automatiques par rôle de comptabilisation (refus QG001 si compte manquant), journaux VT/AC/BQ/PA/OD, numérotation sans trou par journal et année (V38).
- **Règles** : équilibre D = C, écriture comptabilisée intangible, contrepassation seule correction (V38) ; périodes et exercices par module avec ordre de clôture bloquant (V33) ; clôture d'exercice sans à-nouveaux (V121).
- **Contrôle** : piste d'audit chaînée SHA-256 inviolable (V120), contrôles d'intégrité, rapprochement auxiliaires / général (V106).
- **États** : balance, grand livre, bilan et compte de résultat SYSCOHADA par rubriques (V63), TFT (V122), notes annexes (V123).
- **À valider par un expert-comptable** : correspondances des rubriques, TFT, notes annexes ; reclassement ROXGOLD (G-27) ; choix du modèle sans à-nouveaux.
- **Statut : TESTED.**

### F-02 Budget
Budgets par scénario et version, contrôle (désactivé / alerte / blocage) sur demandes, commandes et factures, pré-engagement, sections analytiques par ligne, révisions approuvées par une autre personne, prévisions publiées. **TESTED.**

### F-03 Trésorerie
Comptes banque / caisse / mobile money avec compte GL propre, solde calculé, virements internes, import de relevés avec contrôle de continuité, rapprochement validé, limites et piste d'audit. Cours BCEAO importés. **TESTED.** Réserve : formats de relevés réels par banque non recettés.

### F-04 Fiscalité
Présent : codes TVA par société (taux figés), TVA par ligne sur ventes / achats / notes de frais, retenues à la source paramétrables avec état, écarts de change. **Absent** : déclaration de TVA, télédéclaration, facture normalisée, liasse fiscale. Aucun taux légal n'est prérempli (choix délibéré). **PARTIAL.**

### F-05 Immobilisations
Catégories avec comptes contrôlés, mise en service, reprise d'historique, linéaire / dégressif, calcul mensuel avec contrepassation, cession (vente / mise au rebut) avec plus ou moins-value. **TESTED.** Manque : réévaluation, dépréciation, composants, lien maintenance.

### F-06 Achats
Demande → approbation par niveaux (jamais par l'auteur) → commande → accusé fournisseur → réception (partielle, services par avancement) → facture par lignes → rapprochement 3 voies avec tolérances → paiement (double contrôle des coordonnées bancaires). Demandes de prix et comparatif, retours et avoirs fournisseurs, facture non parvenue (408), dossiers d'import (frais d'approche, douane UEMOA, transit 381). **TESTED.** Manque : délégation, contrats-cadres, évaluation fournisseurs.

### F-07 Stocks
Mouvements uniquement issus de pièces ou de fonctions contrôlées, CMUP, inventaire permanent / intermittent, campagnes d'inventaire à l'aveugle avec contrôle par un tiers, réapprovisionnement, articles non stockés. **TESTED.** Manque : réservation ferme (G-34), lots / séries / péremption (G-49), multi-emplacements fins.

### F-08 Ventes, clients, CRM
Devis → commande (contrôle de limite de crédit) → livraison → facture brouillon → émission (numéro légal) → encaissement, avoirs, acomptes, lettrage automatique, retours, devises, relevé de compte, relances. **TESTED.** Réserve : envoi réel des relances non déployé.

### F-09 RH
Dossier salarié, références (contrats, services, postes), mouvements datés avec approbation, import CSV, temps et absences, libre-service salarié. **TESTED.**

### F-10 Paie
Moteur paramétrable : rubriques, bases, formules contrôlées, barèmes, règles légales versionnées et datées, prorata, cotisations multiples, précontrôle obligatoire, approbation par une autre personne, comptabilisation par rubrique, contrepassation et régularisation, bulletins PDF, paiement par fichier bancaire. **Moteur TESTED** ; **usage réel BLOCKED** tant que les barèmes Burkina Faso ne sont pas saisis et validés avec leur source, et tant que les déclarations (CNSS, IUTS) n'existent pas.

### F-11 Workflows
Les circuits d'approbation sont **codés par module** (achats, factures fournisseurs, notes de frais, budget, paie, attribution des demandes de prix), avec séparation des tâches réelle. Il n'existe **ni moteur transverse, ni délégation / suppléance, ni escalade temporisée**. `workflow_rules` est stockée et modifiable mais sans effet (EV-12) : **écran trompeur à corriger ou à retirer**. **PARTIAL.**

### F-12 Reporting
États comptables réglementaires, rapports par module (17 dans le hub `/reports`), exports CSV / Excel / PDF homogènes, impression de pièces, cockpit CFO consolidé. Modèles versionnés et archives PDF immuables pour la facture client seulement (V141), rendu cloud non configuré. **TESTED (états) / PARTIAL (moteur).**

### F-13 Administration
Catalogue de 153 droits, rôles système et personnalisés, invitations, accès aux modules, calendrier fiscal central, identité de la société, pièces jointes, devises. Identité sur site par l'API (verrouillage, jetons ES256, rotation). **TESTED.**

### F-14 à F-18 EAM, Downtime, Production, Flotte, Mobile
**NOT STARTED.** Aucun code, aucune table, aucun écran. Détail des prérequis : `08_MOBILE_READINESS.md`, `09_EAM_DOWNTIME_AUDIT.md`.

### F-19 Business AI
Voir `10_AI_HUB_READINESS.md`. **PARTIAL.**

## Constats transverses

1. **Qualité de construction élevée sur l'ERP financier** : chaque règle sensible est appliquée dans la base (déclencheurs, fonctions, RLS), donc identique quel que soit le chemin (écran, API, import). C'est le principal actif du produit.
2. **Écart entre « testé » et « en production »** : aucun module n'a de recette métier signée récente ; l'infrastructure de production n'existe pas (lot 1, déploiement VPS non fait).
3. **Les validations réglementaires dépendent de tiers** : expert-comptable (états, G-27), paie (barèmes), fiscalité (déclarations). Elles conditionnent la commercialisation au Burkina Faso plus que le code.
4. **Le périmètre « vision 2030 »** (EAM, Downtime, Production, Flotte, Mobile, IA agentique) est entièrement à construire.
