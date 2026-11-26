# 00 — Synthèse exécutive de l'audit global QUOREICH (QERP)

**Version auditée** : branche `codex/finaliser-module-rh-paie`, commit `7392c6c` (26 nov. 2026), migrations V1–V154.
**Méthode** : lecture du code, requêtes de catalogue en lecture seule (développement et nuage), exécution des suites
automatisées en CI, références externes ; aucun test intrusif, aucune écriture en production, aucun code métier modifié
(seules deux corrections de tests). **Confiance : moyenne** (élevée sur le technique, faible sur le réglementaire non validé).

## Verdict

QUOREICH dispose d'un **ERP financier OHADA techniquement solide** (55 % de maturité pondérée) dont la faiblesse n'est
plus le code métier mais **l'exploitation, les validations externes et la mise en marché**. Aucun défaut critique de
sécurité, d'intégrité comptable ou d'isolation n'a été trouvé. **MVP : Conditional Go. Pilote : No-Go aujourd'hui.**

## Réponses aux 20 questions

1. **Où en sommes-nous ?** 55 % sur l'ERP existant ; MVP élargi (AUD-05) ≈ 51 % pour un seuil de 75 % ; commercial ≈ 30 % (`13`).
2. **Qu'avons-nous développé ?** 17 domaines : comptabilité SYSCOHADA (états, TFT, notes, clôture), ventes, achats et import,
   stocks, trésorerie, budget, immobilisations, RH et paie, notes de frais, projets, conformité / risques, administration,
   2 analyses IA ; une API Java sur site pour chaque module (`01`, `03`).
3. **Qu'est-ce qui est opérationnel ?** Tout ce qui précède est TESTED par 299 tests d'intégration sur vraie base (CI verte
   le 26/11) ; rien n'est STABLE ni PRODUCTION READY faute de recette et de production.
4. **Quels processus sont complets ?** Record to Report, Procure to Pay, Order to Cash, Budget to Control, gestion des
   stocks, Acquire to Retire, paie → comptabilité (moteur) ; Hire to Retire partiel ; maintenance, arrêts, production,
   flotte inexistants (`04`).
5. **Quels modules sont stables ?** Aucun au sens strict (note maximale 3 / 5).
6. **Faiblesses** : exploitation (1 / 5), pas de délégation d'approbation, fiscalité déclarative absente, paie sans barèmes,
   pas de MFA ni de limitation de débit, IA sans gouvernance, documentation utilisateur absente, `main` non protégée.
7. **Risques bloquants** : perte de données (aucune sauvegarde), tests écrivant en production, états non validés, dispersion
   d'une petite équipe sur trop de chantiers (`16`).
8. **Périmètre MVP** : finance, ventes, achats, trésorerie, stocks, administration + exploitation, sécurité, documentation ;
   **plus, en aperçu « en développement »** : application mobile, petite IA, maintenance, arrêts, production (`14`).
9. **Avant le pilote** : B-01 à B-13 (sauvegarde / restauration, recette séparée, production VPS ou nuage dédié, expert-comptable,
   durcissement, MFA, délégation, documentation, parcours rejoués et UAT) (`17`).
10. **Avant la commercialisation** : pilotes signés, pentest, SLA / contrats / licences appliquées, installation reproductible,
    fiscalité déclarative et paie validées.
11. **À reporter** : flotte, agents IA agissant sur les données, i18n, préventif prédictif, OEE complet, Enterprise.
12. **Effort restant MVP** : ≈ 190 j·h hors intervenants externes (≈ 9 mois à un développeur, ≈ 4–5 à deux).
13. **Compétences à ajouter** : exploitation / DevOps, expert-comptable SYSCOHADA, spécialiste paie et fiscalité Burkina Faso,
    développeur mobile, testeur / QA, responsable maintenance (spécification EAM / arrêts), prestataire sécurité.
14. **Plusieurs clients ?** Oui : isolation par société prouvée en profondeur (RLS, déclencheurs, fonctions revues, tests).
    Volumétrie non mesurée.
15. **Assez sécurisé ?** Pour des pilotes après B-06 à B-08 : oui. Pour une exposition commerciale : après pentest.
16. **Prêts pour le mobile ?** Côté serveur largement (API, identité, approbations) ; l'application est à construire (DEC-09).
17. **Prêts pour QERP AI ?** Non : gouvernance d'abord (activation par société, minimisation, journal).
18. **Prérequis du Business AI Hub** : gouvernance, couche d'outils reposant sur les fonctions existantes (droits et
    séparation des tâches déjà en base), jeux d'évaluation, données de production fiables.
19. **Investisseurs** : après un premier pilote signé et une clôture réelle (horizon réaliste T3–T4 2027) ; amorçage plus tôt
    seulement pour financer équipe et exploitation (`19`).
20. **Décisions à prendre maintenant** : voir ci-dessous.

## Décisions demandées à la direction

| # | Décision | Référence |
|---|---|---|
| 1 | Fusionner la PR #1 et protéger `main` | B-02 |
| 2 | Approuver AUD-01 (droits de consultation) et AUD-02 (durcissement `anon`) | `20` |
| 3 | Fixer RPO / RTO et la cible du pilote (nuage dédié ou VPS) | DEC-08, B-01, B-04 |
| 4 | Mandater un expert-comptable pour les états et la clôture | B-05 |
| 5 | Fournir les spécifications maintenance / arrêts et D-01..D-03 ; trancher DEC-09 (mobile) ; préciser « Production » | AUD-05 |
| 6 | Approuver la gouvernance IA (AUD-04) | B-09 |
| 7 | Décider des ressources (recrutement exploitation, mobile, QA) | `17`, `18` |

## Livrables

`01` inventaire · `02` architecture · `03` modules · `04` processus · `05` base · `06` sécurité · `07` UX · `08` mobile ·
`09` maintenance / arrêts · `10` IA · `11` tests · `12` exploitation · `13` maturité (+ CSV) · `14` MVP · `15` commercial ·
`16` risques · `17` backlog · `18` feuille de route · `19` investisseurs · `20` arbitrages · `21` Go / No-Go (+ matrice CSV) ·
`22` preuves.
