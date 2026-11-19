# 24 — Conformité et risques (lot 4, modules 3 et 4 : V113)

19 novembre 2026.

## 1. Constat avant le lot

- **Données** :
  - conformité : tables de référentiels, contrôles et journal des tests ;
  - risques : tables du registre et des évaluations ;
  - aucune donnée, dans le nuage comme sur la copie locale.
- **Accès** : politiques `FOR ALL` ouvertes à tout membre, lecteur compris. Un membre pouvait écrire
  un état « efficace » sur un contrôle ou une cotation sur un risque, sans test ni évaluation.
- **Logique** :
  - les compteurs du référentiel n'étaient jamais calculés ;
  - aucun historique de cotation ;
  - les statuts étaient libres.
- **Écrans** : de démonstration, en anglais. Matrice d'impact, catégories et règles de
  notification étaient écrites en dur.

## 2. Références

- **COSO (contrôle interne)** : contrôle, test d'efficacité, déficience, plan de remédiation.
- **ISO 31000 / COSO ERM** :
  - identification, puis évaluation probabilité × impact ;
  - risque inhérent, puis résiduel après contrôles ;
  - traitement (éviter, réduire, transférer, accepter) ;
  - appétence ;
  - revue périodique.
- **SAP GRC** :
  - Process Control : tests et constats ;
  - Risk Management : registre, évaluations datées, actions ;
  - lien risque ↔ contrôle.
- **AUDCIF** : contrôle interne et piste d'audit.

## 3. Ce qui est livré

### Risques

- **Paramètres de la société** (droit `risks.settings`) :
  - échelle de 3 à 10 ;
  - seuils modéré / élevé / critique ;
  - appétence, c'est-à-dire le score au-delà duquel le risque doit être traité ;
  - délai de revue après évaluation ;
  - catégories.

  Rien n'est imposé. Sans paramétrage : échelle 5, seuils 5 / 10 / 15, pas d'appétence.
- **Registre** (droit `risks.manage`) :
  - un risque se crée « identifié » ;
  - la cotation et le statut ne s'écrivent pas directement ;
  - le code est figé.
- **Évaluation datée** (`risk_assess`, droit `risks.assess`) :
  - probabilité et impact, inhérents puis résiduels ;
  - le résiduel ne dépasse jamais l'inhérent ;
  - cotation sur l'échelle de la société ;
  - historisée, l'historique n'est pas modifiable ;
  - fixe la date de revue si un délai est paramétré.
- **Décision** (`risk_set_status`) :
  - traiter (réduire / éviter / transférer) ;
  - accepter, avec motif ;
  - clôturer, avec motif et seulement sans action ouverte ;
  - rouvrir.

  Une décision n'est possible qu'après une évaluation.
- **Actions de traitement**, avec responsable et échéance.
- **Lien risque ↔ contrôles** de conformité.

### Conformité

- **Référentiels et contrôles** de la société (droit `compliance.manage`) :
  - processus, responsable, niveau de risque couvert, fréquence, procédure de test ;
  - aucun n'est pré-rempli.
- **État d'un contrôle** : il vient seulement de ses tests (`compliance_record_test`, droit
  `compliance.test`).
  - Correspondance : conforme → efficace ; partiel → partiellement efficace ; non conforme →
    déficient.
  - La prochaine échéance suit la fréquence.
  - Un test non concluant exige ses constatations.
- **Compteurs du référentiel** : recalculés par la base (contrôles efficaces sur contrôles actifs
  applicables).
- **Constats** :
  - ouverts par un test ;
  - passés « en cours », puis clôturés avec la remédiation (droit `compliance.close_issue`) ;
  - par défaut, par une autre personne que celle qui les a relevés (paramètre
    `issue_second_person`, droit `compliance.settings`).
- **Tests et constats** : écrits seulement par les fonctions.

**Catalogue** : 131 droits.
- `compliance.manage`, `test`, `close_issue`, `settings`, `export` ;
- `risks.manage`, `assess`, `settings`, `export`.

Ils sont attribués à l'administrateur et aux rôles existants : `compliance_admin` / `officer` /
`auditor`, `risk_admin` / `owner` / `assessor`. Les deux panneaux de rôles des modules lisent ces
droits, et non plus des noms de rôles.

## 4. Écrans

**Risques**
- **Tableau de bord** :
  - indicateurs : ouverts, critiques, au-delà de l'appétence, revues échues, actions en retard ;
  - cartes de chaleur inhérente et résiduelle, teintées selon les seuils de la société ;
  - principaux risques.
- **Transactions** :
  - registre, et fiche du risque : évaluer, décider, actions, contrôles rattachés, historique ;
  - onglet Actions.
- **Données de base** : catégories.
- **Rapports** : registre exportable, répartition catégorie × criticité.
- **Contrôle** :
  - au-delà de l'appétence sans traitement ;
  - jamais évalués ;
  - revues et actions échues ;
  - évalués sans contrôle ;
  - acceptés avec leur motif.
- **Paramètres** : échelle, seuils, appétence, revue, rôles.

**Conformité**
- **Tableau de bord** : taux de conformité et état des contrôles par référentiel.
- **Transactions** : contrôles à tester (« Enregistrer un test »), journal des tests, constats.
- **Données de base** : référentiels et contrôles.
- **Rapports** : matrice des contrôles, journal des tests, constats (Excel, CSV, PDF).
- **Contrôle** :
  - contrôles déficients ou partiels ;
  - tests échus ;
  - jamais testés ;
  - constats en retard ou graves.
- **Paramètres** : clôture par une autre personne, rôles.

## 5. Restes

- **Notifications** (revue échue, constat en retard) : les écrans de contrôle les montrent. L'envoi
  par courriel suivra le module d'alertes.
- **Pièces jointes de preuve des tests** : à brancher sur le stockage, comme les justificatifs des
  notes de frais.
- **Sur site** : pas encore d'API Java pour ces modules (plan des lots 3 à 5).

## 6. Vérification

- `ConformiteRisquesIT` (V113) :
  - risques : création imposée « identifiée », écriture directe de cotation refusée, échelle,
    droits, résiduel ≤ inhérent, historique non modifiable, actions ouvertes bloquant la clôture,
    motif obligatoire, échelle paramétrée à 3, revue à 90 jours ;
  - conformité : état venant des tests, échéance trimestrielle, constat, refus de clôture par
    l'officier (droit) et par l'auteur (deux personnes), compteurs, lien risque ↔ contrôle.
- Parcours **101** :
  - catégorie, paramètres, risque évalué (20), traité, action, contrôle rattaché ;
  - référentiel, contrôle ;
  - test non conforme avec constat ; clôture refusée à l'auteur, faite par le second membre
    (« Auditeur conformité ») ;
  - test conforme → efficace ;
  - tableau de bord et export.
