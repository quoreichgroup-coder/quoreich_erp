# 04 — Audit des processus métier de bout en bout

> Phase 2 de l'audit global. Chaque processus est jugé sur des scénarios d'entreprise (enchaînement de pièces,
> approbations, écritures), pas sur le CRUD. Preuves : tests d'intégration Java (verts en CI le 26/11/2026, EV-11)
> et parcours Playwright (état documenté, **non rejoués dans cet audit**).

## Synthèse

| Processus | Statut | Couverture de bout en bout | Ruptures principales |
|---|---|---|---|
| Record to Report | TESTED | Écriture → lot / journal → période → clôture d'exercice → états SYSCOHADA, TFT, notes | Validation des états par un expert-comptable ; rendu PDF cloud |
| Procure to Pay | TESTED | Demande → approbation → (demande de prix) → commande → réception → facture → rapprochement 3 voies → règlement → écritures | Délégation d'approbation ; contrats-cadres |
| Order to Cash | TESTED | Devis → commande (crédit) → livraison → facture → encaissement → lettrage, avoirs, retours | Envoi réel des relances non déployé |
| Hire to Retire | PARTIAL | Embauche, mouvements datés approuvés, sortie ; temps, congés, libre-service | Pas de recrutement, d'évaluation, de formation ; pas de solde de tout compte dédié |
| Payroll to Accounting | TESTED (moteur) / BLOCKED (réel) | Variables → génération → précontrôle → approbation tierce → comptabilisation par rubrique → paiement bancaire → 422 soldé | Barèmes légaux non saisis ; déclarations CNSS / IUTS absentes |
| Acquire to Retire (immobilisations) | TESTED | Fiche → mise en service → amortissements mensuels → cession avec plus ou moins-value | Pas de création depuis la facture fournisseur ; pas de lien maintenance |
| Budget to Control | TESTED | Budget approuvé → pré-engagement (demande) → engagement (commande) → réalisé (écritures) → contrôle bloquant / alerte → révisions | — |
| Inventory Management | TESTED | Réception → stock (CMUP) → transfert → livraison → inventaire à l'aveugle → écarts comptabilisés | Réservation ferme ; lots / séries / péremption |
| Maintain to Operate | NOT STARTED | — | EAM inexistant |
| Downtime to Reliability | NOT STARTED | — | Module inexistant ; D-01..D-03 non fournis |
| Plan to Produce | NOT STARTED | — | Production inexistante |
| Fleet to Operate | NOT STARTED | — | Flotte inexistante |

## Détail par processus

### P-01 Record to Report
- **Acteurs** : comptable (saisie), administrateur (clôture, réouverture avec motif), auditeur (lecture).
- **Étapes** : écriture brouillon → comptabilisation (D = C, période ouverte, comptes actifs et non regroupements,
  analytique obligatoire selon règles) → numéro de pièce et lot automatiques → contrôles (anomalies, intégrité,
  rapprochement auxiliaires) → clôture des modules puis du GL → clôture d'exercice (résultat en 131 / 139) → états.
- **Exceptions** : erreur après comptabilisation = contrepassation seulement ; réouverture = droit + motif ; chaîne d'audit
  rompue détectée (`gl_audit_chain_breaks`).
- **Preuves** : `JournauxEtLotsIT`, `CalendrierFiscalIT`, `ClotureExerciceIT`, `PisteAuditChaineeIT`, `ControlesGrandLivreIT`,
  `EtatsParRubriquesIT`, `TableauFluxTresorerieIT`, `NotesAnnexesIT` ; parcours 50, 98.
- **Aptitude réelle** : bonne sur la mécanique ; **les états n'ont pas été validés par un expert-comptable** et le modèle
  « sans écritures d'à-nouveaux » doit être confirmé auprès des commissaires aux comptes.

### P-02 Procure to Pay
- **Acteurs** : demandeur, approbateurs L1–L3, acheteur, magasinier, comptable fournisseurs, approbateurs de factures L1–L4,
  trésorier ; séparation des tâches imposée par la base (jamais l'auteur, jamais deux fois la même personne).
- **Étapes** : demande → soumission (pré-engagement budgétaire) → approbations par niveau → (demande de prix, comparatif,
  attribution motivée par un tiers) → commande → accusé fournisseur, suivi des retards → réception partielle (stock ou
  service par avancement ; 408 si facture non parvenue activée) → facture par lignes (contrôle total papier, 3 voies,
  tolérances, devise, retenue à la source) → approbation → écriture AC → règlement (coordonnées bancaires vérifiées par un
  tiers) → écriture BQ, retenue en 447x, écart de change.
- **Exceptions** : sur-réception refusée ; retour fournisseur avec ou sans remplacement ; avoir fournisseur ; contrepassation
  de règlement avec motif ; dépassement budgétaire bloqué ou autorisé avec motif.
- **Preuves** : `CycleDeVieAchatsIT`, `ReceptionsEtPaiementsIT`, `CycleDeVieFacturesFournisseursIT`, `FacturesFournisseursLignesIT`,
  `DemandesDePrixIT`, `RetoursEtAvoirsFournisseursIT`, `RetenuesALaSourceIT`, `ControleBudgetaireIT` ; parcours 10, 20, 30, 105, 106.
- **Ruptures** : pas de délégation (absence d'un approbateur = blocage) ; pas d'escalade ; contrats-cadres absents.

### P-03 Order to Cash
- **Étapes** : devis (TVA, remise) → commande depuis le devis (contrôle de limite de crédit, dérogation tracée) → livraison
  (sortie de stock au CMUP) → facture brouillon reprise de la livraison → émission (numéro légal, écriture VT) →
  encaissement (par tiers, réparti) → lettrage automatique ; avoirs, acomptes, retours clients, devises, relevé, relances.
- **Preuves** : `VentesPiecesCompletesIT`, `NumerotationVentesIT`, `AvoirsClientsIT`, `AcomptesEtLettrageIT`, `RetoursClientsIT`,
  `DevisesVentesIT`, `ArDunningIT` ; parcours 40, 60, 61.
- **Ruptures** : relances par courriel non déployées dans le nuage (fonction et secrets SMTP) ; pas de facture électronique
  normalisée.

### P-04 Hire to Retire
Couvert : dossier salarié avec références, matricule, mouvements datés (embauche, promotion, suspension, sortie) soumis et
approuvés, rétroactivité, temps et congés, libre-service. **Absent** : recrutement, entretiens, formation, compétences, solde de
tout compte dédié, documents de fin de contrat. **PARTIAL.** Preuves : `RhReferentielsIT`, `HrApiIT`, parcours 95.

### P-05 Payroll to Accounting
Génération par segments de présence → précontrôle obligatoire (net négatif bloquant) → approbation par une autre personne
que le préparateur → comptabilisation par rubrique et cotisation (PA) → lot de virement approuvé par un tiers → fichier
bancaire (SHA-256) → retours → DR 422 / CR banque. Contrepassation et régularisation prévues. Preuves :
`PaieProrataPresenceIT`, `PaieReglesVersionneesIT`, `HrApiIT`, parcours 95. **Bloquant pour un usage réel** : barèmes
légaux Burkina Faso (CNSS, IUTS, charges de famille) non saisis ; aucune déclaration sociale / fiscale produite.

### P-06 Acquire to Retire (immobilisations)
Fiche et catégorie (comptes 2x / 28x / 68x contrôlés) → mise en service → calcul mensuel (linéaire, dégressif) avec écriture
OD, contrepassation du dernier calcul → cession (vente ou rebut) avec écriture de sortie et plus ou moins-value. Preuves :
`ImmobilisationsIT`, parcours 91. **Rupture** : l'immobilisation n'est pas créée depuis la facture fournisseur (ressaisie).

### P-07 Budget to Control
Budget (scénario, version) soumis / approuvé par un tiers → contrôle sur demande, commande et facture sans commande
(désactivé / alerte / blocage, par année ou mois, par section analytique) → disponible = prévu − pré-engagé − engagé −
réalisé → révisions approuvées → prévisions. Preuves : `ControleBudgetaireIT`, `BudgetPreEngagementAnalytiqueIT`,
`BudgetLignesPrevisionsImportIT`, `BudgetParametresScenariosIT` ; parcours 90, 92–94. **TESTED.**

### P-08 Inventory Management
Entrées par réception / retour client, sorties par livraison / retour fournisseur, ajustements motivés, transferts entre dépôts,
campagnes d'inventaire (aveugle, contrôle par un tiers, dépôt gelé), écritures 311 / 6031 en inventaire permanent,
réapprovisionnement proposé puis converti en demandes. Preuves : `StocksSecurisationIT`, `ComptabilisationStocksIT`,
`ReapprovisionnementIT`, `ArticlesNonStockesIT` ; parcours 70, 71. **Ruptures** : réservation ferme (G-34), traçabilité par
lot / série / péremption (G-49).

### P-09 à P-12 Maintain to Operate, Downtime to Reliability, Plan to Produce, Fleet to Operate
**NOT STARTED.** Aucune table, fonction, écran ni test. Le module Immobilisations ne gère que la vie comptable de l'actif.
Analyse des prérequis et de l'ordre de construction : `09_EAM_DOWNTIME_AUDIT.md`.

## Intégrations intermodules vérifiées

| Flux | Mécanisme | Preuve |
|---|---|---|
| Achats → Stocks → Finance | Réception = mouvement de stock valorisé au coût de commande ; 311 / 6031 ; 408 optionnel ; facture AC | `ReceptionsEtPaiementsIT`, `ComptabilisationStocksIT`, `FacturesFournisseursLignesIT` |
| Ventes → Stocks → Finance | Livraison = sortie au CMUP ; facture VT ; encaissement BQ ; lettrage 411 | `VentesClientsSecurisationIT`, `AcomptesEtLettrageIT` |
| Paie → Finance → Trésorerie | Écriture PA par rubrique ; lot de virement ; DR 422 / CR banque | `PaieReglesVersionneesIT`, `HrApiIT` |
| Immobilisations → Finance | Écritures d'amortissement et de cession | `ImmobilisationsIT` |
| Achats / factures → Budget | Pré-engagement, engagement, réalisé par section | `BudgetPreEngagementAnalytiqueIT` |
| Notes de frais / projets → Finance | Écriture OD par catégorie, imputation analytique du projet | `NotesDeFraisIT`, `ProjetsIT` |
| Toutes pièces → isolation des sociétés | Déclencheur `assert_same_tenant` sur 61 tables + RLS | `IsolationSocietesIT`, `TenantIsolationIT` |

## Scénarios à rejouer avant toute recette métier

Les parcours existants couvrent les chemins nominaux et les principaux refus. À ajouter ou rejouer en environnement isolé
(société de test), **avec accord préalable** car ils écrivent des données :
1. Clôture complète d'un exercice réel (tous modules) puis ouverture du suivant, comparée à une balance établie à la main.
2. Cycle de paie réel d'un mois avec barèmes validés, comparé à un bulletin établi par un cabinet.
3. Achat importé complet (devise, frais d'approche, transit) jusqu'au coût de revient, comparé au calcul Excel actuel.
4. Absence d'un approbateur pendant une semaine (constat de blocage : délégation absente).
5. Double clic et double onglet sur émission, réception, règlement (G-41, couverture transverse incomplète).
