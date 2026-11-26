# 09 — Audit EAM et Downtime Management

> Phase 4. Spécification EAM / Downtime et décisions **D-01, D-02, D-03 non fournies** (EV-04). Conformément à la
> demande, aucune proposition n'est présentée comme décision approuvée.

## 1. État

| Périmètre (demande §13–14) | Prévu | Développé | Intégré |
|---|---|---|---|
| Hiérarchie d'actifs, postes techniques, équipements, nomenclatures | Non documenté dans le dépôt | Non | Non |
| Avis, ordres de travail, gammes, plans et stratégies de maintenance | Non documenté | Non | Non |
| Planification, arrêts programmés, Gantt, backlog, confirmations | Non documenté | Non | Non |
| Main-d'œuvre, pièces, coûts, historique, préventif / correctif / conditionnel / prédictif | Non documenté | Non | Non |
| Déclaration et classification des arrêts, causes, MTBF, MTTR, Pareto, OEE | Non documenté | Non | Non |
| D-01 / D-02 / D-03 | Cités par la demande seulement | — | — |

**Statut : NOT STARTED** pour EAM, Downtime, Production et Flotte. Le module Immobilisations gère la vie **comptable**
de l'actif (acquisition, amortissement, cession), pas sa vie **technique**.

## 2. Ce que l'ERP actuel apporterait à un module EAM

| Besoin EAM | Brique existante réutilisable |
|---|---|
| Équipement ↔ immobilisation | `assets` (valeur, catégorie, mise en service) — lien un-à-un à prévoir |
| Pièces de rechange | Stocks (articles, dépôts, CMUP, réservation à construire G-34) |
| Achats de pièces et sous-traitance | Demandes / commandes / réceptions de services (V140) |
| Coût des interventions | Comptabilité analytique (axes, sections) et projets (une intervention = une section) |
| Main-d'œuvre | Salariés, temps (V152) |
| Approbations, pièces jointes, numérotation, piste d'audit | Mécanismes transverses existants (V138, séries, `gl_audit_logs`) |

## 3. Références à confirmer avant toute règle métier

La demande cite SAP PM/EAM, SAP MII, ISO 14224 et deux ouvrages (R. Gulati ; *Reliability Engineering for Maintenance
Professionals*). Ils n'ont pas été consultés dans cette phase : leur disponibilité doit être vérifiée et les définitions
(classes d'équipements ISO 14224, taxonomie des défaillances, calcul MTBF / MTTR / disponibilité, OEE) validées avec un
responsable maintenance avant d'être transformées en règles.

## 4. Ordre de construction proposé (à arbitrer)

1. Spécification et décisions D-01..D-03 fournies et statuées.
2. Socle EAM : postes techniques, équipements (lien immobilisation), compteurs.
3. Avis et ordres de travail (correctif), consommation de pièces (stocks), main-d'œuvre (temps), coûts (analytique).
4. Préventif : gammes, plans, échéancier.
5. Downtime : déclaration, causes, chevauchements, indicateurs (MTBF, MTTR, disponibilité), Pareto.
6. Production / OEE et flotte seulement si un client cible le justifie.

Estimation grossière : plusieurs mois de travail pour un socle EAM + Downtime utilisable ; à chiffrer après spécification.
