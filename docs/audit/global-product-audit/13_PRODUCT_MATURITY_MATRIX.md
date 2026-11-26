# 13 — Matrice de maturité

> Phase 5. Échelle 0–5 et pondération de la demande (§32). Score pondéré = Σ (note / 5 × poids). Notes entières,
> attribuées sur preuves ; un élément non vérifié est noté sur ce qui est prouvé, jamais présumé.
> Données pour tableau de bord : `13_maturity_scores.csv`.

## 1. Score global (périmètre ERP existant)

| Dimension | Poids | Note | Pondéré | Justification |
|---|---:|---:|---:|---|
| Couverture fonctionnelle | 20 % | 3 | 12,0 % | 17 domaines ERP implémentés et testés ; fiscalité déclarative, délégation, RH amont absents |
| Intégrité des processus | 15 % | 3 | 9,0 % | R2R, P2P, O2C, budget, stocks, immobilisations, paie → compta testés de bout en bout en intégration ; aucune recette métier signée |
| Sécurité et isolation | 15 % | 3 | 9,0 % | Isolation en profondeur vérifiée ; pas de MFA, pas de limitation de débit, pas de pentest |
| Architecture et maintenabilité | 10 % | 3 | 6,0 % | Saine et testée ; double chemin de données et forte charge PL/pgSQL |
| Intégrité des données | 10 % | 3 | 6,0 % | Contraintes et piste d'audit fortes ; états non validés par un expert-comptable ; aucune sauvegarde |
| Tests et qualité | 10 % | 3 | 6,0 % | 299 tests d'intégration réels verts ; pas de performance, de restauration ni d'UAT ; `main` rouge 6 jours |
| Infrastructure et exploitation | 10 % | 1 | 2,0 % | Image et CI seulement ; ni production, ni sauvegarde, ni supervision |
| UX / UI | 5 % | 3 | 3,0 % | Cohérente et sincère ; non testée avec des utilisateurs, FR seul |
| Documentation et support | 5 % | 2 | 2,0 % | Documentation technique riche ; aucune documentation utilisateur, formation ni support |
| **Total** | 100 % | | **55 %** | |

**Aucun défaut critique** de sécurité, d'intégrité comptable ou d'isolation n'a été constaté : le score n'est pas plafonné
à ce titre. En revanche, deux **conditions non négociables** de la demande ne sont pas remplies quel que soit le score :
**sauvegarde et restauration testées** (inexistantes) et **100 % des tests métier critiques réussis** (parcours non rejoués,
aucune recette).

## 2. Scores spécifiques

| Périmètre | Score | Commentaire |
|---|---:|---|
| ERP existant (ci-dessus) | **55 %** | |
| MVP sans modules en aperçu | **58 %** | Fonctionnel ≈ 3/5 ; infrastructure 1/5 et documentation 2/5 tirent vers le bas ; seuil indicatif 75 % |
| MVP avec modules en aperçu (AUD-05) | **≈ 51 %** | Mobile, IA, maintenance, arrêts, production à 0 aujourd'hui ; le score remonte à chaque module livré |
| Commercial (préparation à vendre) | **≈ 30 %** | Pas d'offre, de contrat, de support, de SLA, d'environnement de démonstration ni d'hébergement de production (détail en 15) |
| Mobile | **0 %** | NOT STARTED ; prérequis serveur présents |
| EAM / Downtime / Production / Flotte | **0 %** | NOT STARTED ; spécification non fournie |
| Business AI | **≈ 15 %** | 2 analyses ; gouvernance absente |

Calcul MVP : mêmes dimensions, couverture fonctionnelle et processus portés à 3,5 sur le périmètre réduit
(20 × 0,7 + 15 × 0,7 + 15 × 0,6 + 10 × 0,6 + 10 × 0,6 + 10 × 0,6 + 10 × 0,2 + 5 × 0,6 + 5 × 0,4 = 58,5 %, arrondi à 58 %). Avec les modules en aperçu, couverture et processus tombent à 2,5 sur le
périmètre élargi (20 × 0,5 + 15 × 0,5 + 15 × 0,6 + 10 × 0,6 × 3 + 10 × 0,2 + 5 × 0,6 + 5 × 0,4 = 51,5 %).

## 3. Scores par module (0–5)

| Module | Note | Module | Note |
|---|---:|---|---:|
| Comptabilité générale / états | 3 | Ventes, clients, CRM | 3 |
| Budget | 3 | RH | 3 |
| Trésorerie | 3 | Paie (moteur) / (usage réel) | 3 / 1 |
| Fiscalité | 2 | Notes de frais, projets | 3 |
| Immobilisations | 3 | Conformité, risques | 3 |
| Achats, import | 3 | Workflows | 2 |
| Stocks | 3 | Reporting | 3 |
| Administration, droits | 3 | Business AI | 1 |
| Mobile, EAM, Downtime, Production, Flotte | 0 | | |

Aucun module ne dépasse 3 : la note 4 exige une intégration **et** une recette métier, la note 5 une exploitation de production.

## 4. Couverture de l'audit et niveau de confiance

| Domaine | Couvert | Confiance |
|---|---|---|
| Code, migrations, schéma (développement et nuage) | Oui, lecture et requêtes de catalogue | Élevée |
| Tests automatisés | Exécutés en CI le 26/11 | Élevée |
| Parcours de bout en bout | Non rejoués (écrivent des données) | Moyenne |
| Validité comptable et fiscale | Non (expert-comptable requis) | Faible |
| Performance, charge, restauration | Non (inexistants) | — |
| Alignement vision 2030, D-01..D-03, prototypes mobile | Non (documents non fournis) | Non évaluable |

**Confiance globale : moyenne.** Le score de 55 % est fiable sur le technique, provisoire sur le métier réglementaire.
