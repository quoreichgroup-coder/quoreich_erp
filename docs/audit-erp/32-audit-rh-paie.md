# 32 — Audit du module RH & Paie (25 novembre 2026)

Commande : `docs/impove/QERP_Audit_RH_Paie_Prompt.md`. Méthode : lecture du schéma réel (V5, V63, V80–V104), des fonctions
PL/pgSQL en vigueur (dernière définition de chaque fonction), de l'API Java `services/api/.../hr/` (`HrController`,
`HrQuery`), des écrans (`src/pages/Hr*.tsx`, `PayrollRuns.tsx`, `PayrollSettingsCard`, `HrPayrollComponentsCard`,
`src/hooks/use-hr-data.ts`) et des tests (`HrApiIT`, `EtatsParRubriquesIT`, `RhReferentielsIT`). Aucune fonction n'est
déclarée absente sans recherche dans les migrations, l'API et le front.

Rappel d'architecture : le calcul n'est **pas** dans React ni dans des services Java. Il est entièrement dans PostgreSQL
(`generate_payroll_lines`, SECURITY DEFINER), appelé à l'identique par Supabase (cloud) et par l'API Java (sur site),
qui ne fait que transmettre. C'est le bon choix pour un ERP à deux cibles ; il est conservé.

## A. Diagnostic de l'existant

Criticité : **P0** = risque de calcul / comptable démontré ; P1 = moteur et rubriques ; P2 = intégration, imports,
workflows ; P3 = avancé, rapports, multi-pays.

| # | Fonction | État réel (vérifié) | Insuffisance | Crit. | Recommandation |
|---|---|---|---|---|---|
| 1 | Règles par pays | `hr_payroll_settings` (V80) : pays, devise, taux salarié / employeur, plafonds, tranches progressives, date d'effet, référence, confirmation par `confirm_payroll_rules` (droit `hr.payroll_settings`) ; rien de prérempli ; photographie sur chaque cycle ; écriture directe de la confirmation interdite (V104). | **Une seule version par société** (upsert) : pas d'historique des barèmes ; un cycle d'une période antérieure à la nouvelle date d'effet ne peut plus être recalculé. Une seule cotisation salariale et une seule patronale (pas CNSS + autres organismes distincts). | P1 | Versions datées de règles (une ligne par date d'effet, validation par version), organismes / cotisations multiples avec plafond propre. |
| 2 | Calcul du salaire de base | État du dossier lu **au dernier jour** de la période ; `hire_date` jamais lu. | **Embauche le 20 → mois complet ; sortie / suspension le 10 → 0 ; augmentation le 15 → mois complet ; salarié « actif » embauché le mois suivant → payé.** | **P0** | **Corrigé par V148** (prorata par segments de présence, méthode paramétrable). |
| 3 | Rubriques | `hr_payroll_components` (V84–V87, V99) : gain / retenue / charge employeur, `fixed` ou `percent_base` (du salaire de base seulement), plafond, dates d'effet, assiettes imposable / sociale salariale / patronale, compte, ordre, impression. Affectations datées par salarié (V85, V88), variables par cycle avec approbation distincte (V86). | Méthodes limitées à 2 (pas quantité × taux, barème, formule, conditionnel) ; base = salaire de base uniquement (pas de base de calcul ni de rubrique de cumul) ; ordre de calcul = ordre alphabétique du code (`ORDER BY code`), pas de priorité ni dépendance ; pas de rubrique par établissement / catégorie ; **un « Ajouter » avec un code existant remplaçait silencieusement la rubrique** (upsert). Définition non versionnée (modifier un montant n'a pas d'historique). | P0 (écrasement) / P1 | Écrasement **corrigé par V148**. P1 : bases de calcul nommées, priorité, méthodes `quantity_rate` / `scale` / `formula` (langage contrôlé, sans code arbitraire), détection de cycles. |
| 4 | Prorata des rubriques | Aucun. | Une prime fixe était versée entière à un salarié présent 10 jours. | P0 | **Corrigé par V148** : `prorated` par rubrique (opt-in), les % suivent la base proratisée, les variables gardent leur montant. |
| 5 | Impôt progressif | `compute_progressive_payroll_tax` sur (imposable − cotisation salariale), tranches mensuelles validées (V97). | Pas d'abattement, de charges de famille (quotient / réduction), d'exonération, ni de cumul annuel ; arrondi fixe à 2 décimales (le XOF n'a pas de décimale). | P1 / P3 | Paramètres d'abattement et de charges de famille **à faire valider** (IUTS Burkina) ; règle d'arrondi par devise. Aucune valeur légale ne sera inventée. |
| 6 | Net négatif | Calculé sans contrôle. | Un cycle avec net < 0 pouvait être approuvé puis comptabilisé (dette 422 débitrice). | **P0** | **Corrigé par V148** : anomalie bloquante du précontrôle. |
| 7 | Cycle et bulletins | `payroll_runs` brouillon → génération → précontrôle (V89) → approbation par une autre personne (V103) → comptabilisation ; écritures directes fermées (V104) ; lignes et rubriques figées par photographie ; bulletin imprimable / CSV / Excel (ordre photographié V99). | Pas de cycle hors période (rappel, acompte, solde de tout compte), pas de **contrepassation / correction** d'un cycle comptabilisé — alors que `approve_employee_movement` renvoie vers « une correction de paie » qui n'existe pas. Pas de cumuls annuels. | P1 | Cycle de régularisation (rappel rétroactif = différence recalculée sur les périodes clôturées, sans toucher les bulletins clôturés) ; contrepassation par `reverse_journal_entry`. |
| 8 | Mouvements RH | `employee_movements` (V82–V83, V95, V102) : effectifs-datés, motif, soumission / approbation par une autre personne, journal immuable, références par société, actions groupées. | Champs limités (salaire, devise, service, poste, contrat, fin, statut) ; pas de pièce justificative (V138 couvre d'autres pièces, pas `employee_movement`) ; un mouvement est refusé seulement si un cycle **comptabilisé** existe, pas s'il est approuvé. | P2 | Pièces jointes sur les mouvements ; refus aussi sur cycle approuvé. |
| 9 | Matricules | `hr_employee_number_settings` + `next_hr_employee_number` (V95), saisie libre possible, unicité. | — | — | Conforme. |
| 10 | Salariés et contrats | `employees` (V5) + références (V102). | Pas d'objet contrat (un seul type courant, pas d'historique de contrats successifs ni de période d'essai) ; défaut de colonne `currency = 'XOF'` codé en dur (V5) ; pas d'établissement ni de catégorie de personnel. | P2 | Table de contrats datés ; établissement / catégorie comme références (servent aussi au mapping comptable). |
| 11 | Absences, congés, heures sup. | **Absent** (aucune table, aucune RPC, aucun écran ; vérifié). | Les absences non payées et les heures supplémentaires ne peuvent passer que par des variables manuelles. | P2 | Types d'absence paramétrables (payée / non payée / % maintien), acquisition de congés, heures sup. par taux paramétré, transmises au cycle comme variables approuvées. |
| 12 | Paiement des salaires | **Absent** (pas de lot de paiement, de fichier bancaire, de retour). | Le 422 n'est soldé que par une écriture manuelle. | P2 | Lot 1 de `docs/roadmap-paie-rh.md` (inchangé). |
| 13 | Comptabilisation | `post_payroll_run` (V98) : par compte de rubrique, sinon rôles `PAYROLL_*` ; équilibre garanti ; double comptabilisation refusée (statut). | Une seule écriture agrégée par cycle : pas d'imputation analytique (service / section), pas de mapping par catégorie ou établissement ; le contrôle « écriture estimée déséquilibrée » du précontrôle est une tautologie (toujours vrai par construction). | P2 | Imputation analytique par ligne de salarié (`impute_line_analytics`), jeux de comptes par catégorie (modèle V105). |
| 14 | Déclarations | **Absent** (pas d'état CNSS, IUTS, DIPE). | — | P3 | Gabarits de déclaration par pays, alimentés par les cycles comptabilisés ; formats à faire valider. |
| 15 | Import | `import_hr_employees` (V95) : 1 à 1 000 lignes, tout ou rien, matricule auto. | Pas de simulation, de prévisualisation serveur, de détection de doublons avant écriture, ni de journal d'import ; pas d'import des rubriques, affectations, variables. | P2 | Même méthode que l'import de plan comptable (V65) : préparation → contrôle par ligne → validation, sans écrasement. |
| 16 | Droits | Catalogue central (`hr.*`), séparation préparateur / approbateur effective (V103), lecture des détails sous `view_sensitive` (V87), RLS par société. | — | — | Conforme. |
| 17 | Audit | `payroll_run_audit`, `payroll_run_prechecks` immuables, `employee_movement_audit` immuable. | Pas d'historique des modifications de rubriques ni de barèmes (seule la photographie du cycle les conserve). | P2 | Journal des définitions (avant / après). |

## B. Causes

- **Prorata (2, 4)** : `generate_payroll_lines` (V86 → V99) appelait `hr_employee_state_at(employee, _period_end)` une seule
  fois et testait `status = 'active'`. Le modèle effectif-daté de V82 était donc lu comme un instantané de fin de mois.
- **Net négatif (6)** : `precheck_payroll_run` (V89 / V98) contrôle les totaux et les comptes, jamais le signe du net
  par salarié.
- **Écrasement (3)** : `save_hr_payroll_component` (V84 / V87) faisait `INSERT … ON CONFLICT (tenant_id, code) DO UPDATE`,
  et l'écran envoyait la même charge utile en création et en modification (sans identifiant).
- **Moteur limité (1, 3, 5)** : la V80 a posé une structure « une ligne de règles par société » et la V84 deux méthodes
  de calcul. Il n'existe ni table de bases de calcul, ni graphe de dépendances, ni version de règles.
- **Absences, paiement, déclarations (11, 12, 14)** : lots planifiés dans `docs/roadmap-paie-rh.md` et jamais réalisés.

## C. Architecture cible (progressive, sans refonte)

Le moteur reste en PL/pgSQL, seul point de calcul pour le cloud et le sur-site.

1. **Règles légales versionnées** : `payroll_rule_versions` (société × pays × date d'effet, statut brouillon / validée,
   validateur, référence) remplace la ligne unique ; le cycle choisit la version en vigueur au premier jour de la
   période. `hr_payroll_settings` reste la vue de la version courante (compatibilité des API).
2. **Cotisations multiples** : `payroll_contributions` (code, organisme, taux salarié / patronal, plafond, assiette,
   compte) dans la version de règles.
3. **Bases et rubriques** : `payroll_bases` (somme nommée de rubriques), `hr_payroll_components.priority`,
   `calculation_method` ∈ {fixed, percent_base, quantity_rate, scale, formula}, `formula` évaluée par un petit
   interpréteur PL/pgSQL (nombres, + − × ÷, MIN / MAX / ARRONDI, références de bases) — jamais `EXECUTE` de texte utilisateur.
   Détection des dépendances circulaires à l'enregistrement.
4. **Présence** : livré (V148).
5. **Absences et heures** : types d'absence et demandes approuvées → variables de cycle.
6. **Régularisation** : cycle `kind = 'regularization'` qui recalcule une période close avec les données actuelles et
   paie la différence ; les bulletins clos ne sont jamais modifiés.
7. **Comptabilisation** : imputation analytique par salarié ; jeux de comptes par catégorie.
8. **Import** : préparation / contrôle / validation (modèle V65).

## D. Plan d'amélioration

| Priorité | Évolution | État |
|---|---|---|
| P0 | Prorata de présence (embauche, sortie, suspension, changement de salaire en cours de mois), méthode paramétrable | **Fait — V148** |
| P0 | Net négatif bloquant au précontrôle | **Fait — V148** |
| P0 | Rubrique jamais écrasée sans son identifiant | **Fait — V148** |
| P1 | Versions datées des règles légales ; cotisations multiples | **Fait — V149** |
| P1 | Arrondi paramétrable ; abattement par catégorie ; réduction pour charges de famille ; exonération partielle des rubriques | **Fait — V149** (valeurs à saisir et valider par la société) |
| P1 | Bases de calcul, priorité, méthodes quantité × taux / barème / formule contrôlée | **Fait — V150** |
| P1 | Régularisation et contrepassation d'un cycle comptabilisé | **Fait — V151** |
| P2 | Absences, congés, heures supplémentaires | **Fait — V152** |
| P2 | Paiement des salaires (lot 1 de la feuille de route) | **Fait — V154** |
| P2 | Import RH avec simulation ; historique des rubriques et barèmes ; pièces jointes sur mouvements | À faire |
| P2 | Analytique et jeux de comptes dans l'écriture de paie | À faire |
| P3 | Déclarations CNSS / IUTS, cumuls annuels, autres pays | À faire |

## E. Réalisations (V148)

- `services/api/src/main/resources/db/migration/V148__paie_prorata_presence_et_controles.sql` et sa jumelle
  `supabase/migrations/20261125100000_4e5f6a7b-8c9d-4aef-b012-3c4d5e6f7a8b.sql` (identiques) :
  `hr_payroll_settings.proration_method` (`calendar_days` par défaut, `thirty_days`), dont la modification retire la
  confirmation ; `hr_payroll_components.prorated` (faux par défaut) ; `payroll_day_weight` ;
  `payroll_presence_segments` (interne) ; `generate_payroll_lines` par segments, photographie de la présence (jours,
  référence, taux, segments) et de la méthode ; `precheck_payroll_run` + net négatif ; `list_hr_payroll_components`
  expose `prorated` ; `save_hr_payroll_component` crée sans identifiant (code existant refusé) et modifie avec
  identifiant.
- API Java : `HrQuery` lit et enregistre `proration_method` (une requête sans ce champ ne remplace pas la valeur
  enregistrée).
- Écrans : `PayrollSettingsCard` (« Prorata des entrées et sorties en cours de mois »), `HrPayrollComponentsCard`
  (« Proratiser selon les jours de présence », identifiant transmis en modification, mention « proratisé »),
  `use-hr-data.ts`.
- Tests : `PaieProrataPresenceIT` (embauche le 16, embauche après la période, sortie le 11, augmentation le 16, prime
  proratisée et non proratisée, net négatif bloquant, février sur 30 jours, retrait de la confirmation, méthode
  invalide refusée, rubrique non écrasée) ; `SchemaMigrationIT` déclare les deux nouvelles fonctions.

Effet sur les données : aucune donnée existante n'est modifiée. Les sociétés existantes gardent leurs barèmes confirmés
avec la méthode « jours calendaires » ; les rubriques existantes ne sont pas proratisées. Les cycles déjà calculés
gardent leurs lignes ; un brouillon recalculé applique le prorata. Retour arrière : recréer les fonctions de V99 / V98 /
V87 (les deux colonnes ajoutées peuvent rester, elles sont ignorées).

## E bis. Réalisations (V149) — règles légales versionnées

Références consultées pour la **structure** (aucun taux repris : les sources se contredisent et doivent être
vérifiées sur les textes en vigueur) :
- Odoo, règles salariales (séquence, catégories, registres de cotisations) :
  [documentation Odoo](https://www.odoo.com/documentation/19.0/applications/hr/payroll/salary_rules.html) ;
- Sage Paie, cotisations par organisme, taux salarial / patronal, tranches entre plancher et plafond :
  [documentation Sage](https://documentation.sage.fr/bupme/DOCS/PAIE/R&D/pps2025B/PS251101.pdf) ;
- Burkina Faso, IUTS : abattement forfaitaire selon la catégorie (cadre / non-cadre) avec minimum / maximum, indemnités
  exonérées dans une limite, réduction d'impôt selon le nombre de charges (nombre plafonné) —
  [CGI 2023 (DGI)](https://dgi.bf/wp-content/uploads/2023/10/CODE-GENERAL-DES-IMPOTS-2023-A-JOUR-AVEC-LA-LOI-DE-FINANCE-2023.pdf),
  [L'Économiste du Faso](https://leconomistedufaso.com/2023/12/18/iuts-mode-de-calcul-dans-le-secteur-prive/) ;
- Burkina Faso, CNSS : branches à taux distincts (pension, prestations familiales, risques professionnels), plafond
  fixé par arrêté — [loi 004-2021/AN](https://an.bf/storage/Loi/kh5PSt0jXMbbmdzEE89bH08kf5dw27KYt24h7EAa.pdf),
  [NATLEX](https://natlex.ilo.org/dyn/natlex2/r/natlex/fe/details?p3_isn=113777).

Livré :
- `payroll_rule_versions` (une version par date d'effet ; brouillon → validée → archivée ; pays, devise, source
  officielle, prorata, arrondi des montants — unité et sens —, arrondi de la base imposable, barème, abattements par
  catégorie de paie avec base / taux / minimum / maximum, réductions pour charges de famille et nombre maximal retenu) ;
  `payroll_contributions` (code, organisme, taux salarié / employeur, plancher, plafonds, déductibilité de l'impôt,
  compte de l'organisme, compte de charge patronale). Une version validée est figée pour tous (trigger) ; droit
  `hr.payroll_rules_validate` (admin, hr_admin ; catalogue 146) ; la validation liste toutes les anomalies.
- Le cycle prend la version validée la plus récente au 1er jour de la période et la photographie entièrement ;
  une société sans version validée garde ses règles actuelles (converties en une cotisation « SOCIAL », mêmes
  montants qu'avant).
- Chaque cotisation devient deux lignes de bulletin (part salariale, part patronale) et est comptabilisée sur ses
  comptes (sinon rôles de paie), écriture regroupée par compte ; les cycles antérieurs gardent la comptabilisation V98.
- Salarié : `payroll_category` (nouveau référentiel « Catégorie de paie ») et `tax_dependents`, modifiables
  uniquement par mouvement daté et approuvé. Rubrique : exonération partielle (% du salaire de base, plafond).
- Écrans : `PayrollRuleVersionsPanel` (Paramètres RH → Règles de paie : versions, brouillon, valider, archiver,
  copier en nouvelle version, reprendre les règles actuelles), mouvement RH (catégorie, charges), rubriques
  (exonération), référentiel « Catégories de paie ». API Java : `/api/v1/hr/payroll/rule-versions` (+ `/validate`,
  `/archive`, `/delete`).
- Tests : `PaieReglesVersionneesIT` (cas complet calculé à la main : plafonds, abattement cadre plafonné, autres
  catégories, 3 charges ramenées à 2, base arrondie à la centaine, exonération du logement, écriture équilibrée ;
  versions selon la date, archivage, figement, droits) ; `PayrollRuleVersionsPanel.test.tsx` ; `AuthorizationsApiIT`
  (146 droits). Exécution à blanc de V148 + V149 sur la base de développement (transaction annulée) : réussie.

## E ter. Réalisations (V150) — ordre de calcul, bases, formules

Références de structure : Odoo (règles évaluées par séquence, une règle n'utilise que les résultats des règles de
séquence inférieure ; catégories qui cumulent), SAP (règles de calcul et cumuls), Sage Paie (rubriques de base, de
cumul et de calcul).

- `hr_payroll_components.priority` (ordre de calcul ; à égalité, ordre du code comme avant), `base_code`, `formula`,
  `scale` / `scale_mode` ; méthodes `quantity_rate`, `scale`, `formula` en plus de `fixed` et `percent_base`.
- `payroll_bases` : base nommée = salaire de base (option) + rubriques ; même espace de noms que les rubriques.
- Dépendances : une rubrique n'utilise (formule ou base) que des rubriques de priorité strictement inférieure ;
  `payroll_dependency_issues` contrôle toute la société à chaque enregistrement de rubrique ou de base et avant chaque
  calcul : une dépendance circulaire est impossible.
- Langage de formule propre (`payroll_formula_rpn` → notation polonaise inverse, `payroll_formula_eval`) : nombres,
  + − × ÷, comparaisons, parenthèses, MIN / MAX / ROUND / FLOOR / CEIL / ABS / IF, variables BASE, GROSS, QTY, RATE,
  DAYS_PRESENT, DAYS_TOTAL, RATIO, DEPENDENTS, SENIORITY_MONTHS, références `[code]`. Aucun `EXECUTE`, aucun code
  utilisateur exécuté ; tout autre caractère (`;`, guillemets…) est refusé à l'enregistrement. `payroll_formula_try`
  sert au bouton « Tester la formule ».
- Quantité : sur l'affectation du salarié (`hr_employee_payroll_components.quantity`) ou par la variable approuvée du
  cycle (pour une rubrique quantité × taux ou formule, le montant de la variable est la quantité).
- Photographie de chaque ligne : priorité, base utilisée et sa valeur, quantité, formule, barème ; bases actives dans
  la photographie du cycle.
- Écrans : carte « Rubriques » (méthode, base, ordre, formule + test, barème, section « Bases de calcul »),
  affectation (quantité). API Java : `/api/v1/hr/payroll/bases`, `/api/v1/hr/payroll/formula-test` ; les colonnes
  jsonb renvoyées par les fonctions sont restituées en JSON.
- Tests : `PaieReglesVersionneesIT.basesOrdreEtFormules` (heures supplémentaires 10 × 1 250, ancienneté par formule
  sur 64 mois, base « brut cotisable », logement 10 % de la base, barème, retenue `ROUND([logement] / 2, 0)`, refus
  d'une boucle, d'un déplacement d'ordre et d'un caractère interdit) ; exécution à blanc sur la base de développement :
  analyse et calculs vérifiés (12 500 ; 50 000 ; −19 ; 11 ; tranche 2) et six formules invalides refusées ;
  `HrPayrollComponentsCard.test.tsx` (formule enregistrée sans montant, test de formule).

## E quater. Réalisations (V151) — contrepassation et régularisation

Références : SAP (paie rétroactive : recalcul de la période, différences reportées), Sage Paie (rappels de salaire,
bulletins complémentaires) ; principe conservé : un bulletin comptabilisé n'est jamais modifié.

- Cause levée : `UNIQUE (tenant_id, period)` n'autorisait qu'un cycle par mois. Remplacé par : un cycle normal non
  contrepassé par période, une régularisation ouverte à la fois par période.
- `reverse_payroll_run(cycle, motif, date)` (droit `hr.reverse_payroll`, catalogue 147) : écriture contrepassée par
  `reverse_journal_entry`, cycle « reversed » (le verrou des cycles comptabilisés n'admet que cette transition), lignes
  conservées ; refusée tant qu'une régularisation comptabilisée plus récente existe ; la date doit être dans une période
  ouverte (contrôle fiscal existant sur `pay_date`).
- `create_payroll_regularization(cycle, date de paiement, motif)` : cycle `run_kind = 'regularization'` de la même
  période ; `generate_payroll_lines` recalcule la période (cœur V150 renommé `payroll_generate_core`) puis
  `payroll_apply_regularization` ne garde que la différence avec tout ce qui est comptabilisé pour la période, par
  rubrique et par salarié (montants signés, détail « déjà comptabilisé / recalculé » photographié). Refusée si la
  période a été calculée avant le détail des cotisations (V149) : contrepasser puis recalculer.
- Comptabilisation : solde signé par compte (un montant négatif passe au côté opposé), net négatif = débit du compte du
  personnel (trop-perçu à récupérer), impôt négatif = débit de l'État ; `payroll_runs.journal_entry_id` rattache
  l'écriture (repris pour les cycles déjà comptabilisés).
- Mouvement RH rétroactif : désormais approuvable ; l'audit du mouvement liste les périodes comptabilisées à régulariser.
- Écrans : fenêtre du cycle (« Régulariser la période », « Contrepasser » avec motif et date, nature et contrepassation
  affichées), liste (« Contrepassé », mention « régularisation »). API : `POST /api/v1/hr/payroll/runs/{id}/reverse`,
  `/regularization`.
- Test : `PaieReglesVersionneesIT.regularisationEtContrepassation` (augmentation rétroactive : +20 000 brut, 422
  crédité de 18 000 ; retenue oubliée : net −5 000, 422 débité ; contrepassation refusée hors ordre et sans droit,
  acceptée sur la dernière régularisation, écriture inverse vérifiée, cycle contrepassé figé).

## E quinquies. Réalisations (V152) — absences, congés, heures supplémentaires

Références : [Odoo Congés](https://www.odoo.com/documentation/17.0/applications/hr/time_off.html) (types liés à un type
de prestation de paie, allocations et plans d'acquisition, approbation, absences non payées) ; SAP Time Management ;
Burkina Faso, Code du travail (loi 028-2008/AN, [NATLEX](https://natlex.ilo.org/dyn/natlex2/r/natlex/fe/details?p3_isn=79332),
[guide AfriCarrières](https://africarrieres.com/burkina-faso/fr/guide/droit-du-travail/heures-et-conges)) : congé acquis
par mois de service, heures supplémentaires majorées. Les sources se contredisent (2,5 jours par mois ou 22 jours par
an ; majorations 25 / 35 % ou 60 %) : **aucune durée ni majoration n'est préremplie**.

- `hr_time_types` : absence / congé / heures sup., jour ou heure, jours ouvrés ou calendaires, rubrique liée (quantité ×
  taux ou formule — c'est là que se paramètre la majoration ou la retenue, ex. `ROUND(BASE / DAYS_TOTAL * QTY, 0)`),
  suivi d'un solde, acquisition mensuelle, solde négatif, approbation par une autre personne.
- `hr_time_requests` : un mois par demande, quantité calculée ou saisie (≤ décompte), chevauchement d'absences refusé,
  décision par une autre personne, motif de rejet, annulation tant que non transmise.
- `hr_leave_ledger` (immuable) : acquisitions (une par mois et par type, salariés présents au moins un jour selon la
  règle de présence de la paie), prises, recrédits d'annulation, ajustements motivés (reprise de solde).
- `transfer_hr_time_to_payroll(cycle)` : une variable approuvée par demande du mois sur la rubrique du type ; jamais deux
  fois. Droits `hr.time_request` (admin, hr_admin, hr_clerk), `hr.time_approve` (admin, hr_admin, hr_approver),
  `hr.time_settings` (admin, hr_admin) ; catalogue 150.
- Écrans : RH → Transactions → « Temps et absences » (`/hr/time` : demandes, soldes, types), bouton « Reprendre les temps
  approuvés » du cycle. API : `/api/v1/hr/time/*`, `POST /api/v1/hr/payroll/runs/{id}/transfer-time`.
- Test : `PaieReglesVersionneesIT.tempsAbsencesEtConges` (5 jours acquis sur deux mois, acquisition non doublée, auteur
  refusé, chevauchement refusé, solde insuffisant refusé, absence du vendredi au lundi = 2 jours ouvrés, 10 h × 1 500,
  retenue 20 000, net 305 000, transmission unique, annulation interdite après transmission, recrédit du solde) ;
  `HrTime.test.tsx`.
- Limites de V152 levées par V153 (ci-dessous).

## E sexies. Réalisations (V153) — jours fériés, acquisition automatique, libre-service

Références : Odoo [Jours fériés](https://www.odoo.com/documentation/19.0/applications/hr/time_off/public_holidays.html)
(aucun par défaut, déduits de la durée sauf pour les types qui les incluent),
[plans d'acquisition](https://www.odoo.com/documentation/19.0/applications/hr/time_off/accrual_plans.html) (action
planifiée, prorata du temps travaillé en option), approbation par type (responsable, approbateur du salarié, aucune) ;
SAP calendrier des jours fériés (dates fixes et mobiles, report d'un férié tombant un week-end) ; Burkina Faso, loi
001-2026/ALT (11 jours chômés et payés ; fêtes religieuses fixées chaque année par communiqué ;
[Burkina24](https://burkina24.com/?p=435704), [allAfrica](https://fr.allafrica.com/stories/202601120083.html)) —
aucune date préremplie ; le report du dimanche au lundi (loi de 2015) est une option par férié, à confirmer pour 2026.

- `hr_public_holidays` : férié ponctuel ou récurrent (jour / mois), report au lundi, source ; `hr_holiday_dates`
  décline le calendrier d'une année ; le décompte des demandes exclut les fériés sauf `include_public_holidays`.
- Acquisition automatique : `accrual_from` (début) et `accrual_prorata` par type ; mois complets écoulés acquis une
  fois, rattrapés avant chaque approbation, à chaque lecture des soldes (nuage et sur site) et chaque jour sur site
  (`qerp_jobs.hr_leave_accrue_all`, `HrLeaveAccrualJob`, `qerp.hr.accrual-enabled`). Présence calculée sans contexte
  utilisateur (`hr_employee_presence_days`, même règle que la paie).
- Libre-service : `employees.user_id` (compte rattaché par les RH, un compte par fiche) et `time_approver_user_id`
  (approbateur désigné) ; types `self_service` et `approval_mode` (`officer` / `manager` / `none`) ; le salarié
  saisit, annule et consulte ses demandes et soldes (`my_hr_self_service`, `submit_my_time_request`,
  `cancel_my_time_request`) ; l'approbateur désigné décide sans droit RH ; un salarié ne décide jamais ses propres
  demandes. Droit `hr.self_service` accordé à tous les rôles système (il ne donne accès qu'à sa fiche) ; catalogue 151.
- Écrans : « Temps et absences » (onglets Jours fériés, Comptes libre-service ; types : fériés comptés, acquisition
  automatique, prorata, libre-service, approbation) ; nouvelle page « Mon espace RH » (`/hr/me`). API : `/api/v1/hr/
  time/holidays`, `/api/v1/hr/me`, `/api/v1/hr/self-service/links`, `/api/v1/hr/employees/{id}/self-service`.
- Test : `PaieReglesVersionneesIT.feriesAcquisitionAutoEtLibreService` (1er mai récurrent et dimanche reporté :
  4 jours ouvrés au lieu de 6 ; 3 mois acquis automatiquement une seule fois, prorata d'une embauche au 16 ; tâche
  quotidienne sans doublon ; compte non rattaché ; type fermé au libre-service refusé ; approbation refusée au salarié
  et à un tiers, acceptée pour l'approbateur désigné ; solde 4,5 ; type sans validation approuvé d'office ; annulation
  recréditée) ; `HrSelfService.test.tsx` ; `AuthorizationsApiIT` (droit accordé à tous les rôles).
- Restent : approbation en deux étapes (approbateur puis RH), pièces jointes sur les demandes, jours de travail
  propres à un établissement (calendrier unique par société), demandes de plusieurs mois en une saisie.

## E septies. Réalisations (V154) — paiement des salaires

Références : Odoo [lots de paiement](https://www.odoo.com/documentation/master/applications/finance/accounting/payments/batch.html)
(fichier unique pour le portail bancaire, rapprochement par référence du lot, lignes rejetées retirées) et
[bulletins](https://www.odoo.com/documentation/17.0/applications/hr/payroll/payslips.html) (coordonnées bancaires
requises) ; Infor Anael [virements paramétrables](https://docs.infor.com/anaelpws/2.x/fr-fr/useradminlist/Infor%20-%20HCM%20Anael%20Paie%20WS%20-%20Virement%20parametrable-01_16981.pdf) ;
zone UEMOA : aucun format standard trouvé — les banques fournissent leur gabarit, aucun format n'est présumé.

- `payroll_bank_file_profiles` : colonnes ordonnées (12 champs ou valeur fixe ; montant et RIB obligatoires),
  séparateur, encodage (UTF-8, ISO-8859-1, Windows-1252), en-tête, format de date, décimales.
- `payroll_payment_batches` / `payroll_payment_lines` : lot depuis un cycle comptabilisé (net positif restant dû, RIB
  manquant refusé nominativement, devise du compte = devise de la paie), approbation par une autre personne
  (`hr.payroll_payment_approve`), fichier généré une fois et conservé avec son SHA-256, annulation tant que non émis,
  retours payé / rejeté (motif) ; un salarié n'est jamais dans deux paiements actifs du même cycle, un rejet se repaie.
- Comptabilisation des payés : DR rémunérations dues (`PAYROLL_NET_PAYABLE`) / CR banque, journal BQ (source
  `payroll_payment`), mouvement de trésorerie `payroll` à la référence du lot (rapprochement bancaire V71) ; période de
  trésorerie ouverte exigée. `payroll_run_payment_status` : net, payé, en cours, rejets à repayer.
- Droits `hr.payroll_payment` (admin, hr_admin), `hr.payroll_payment_approve` (admin, hr_approver) ; catalogue 153.
  RIB affiché en clair au préparateur et aux droits sensibles, masqué sinon.
- Écran RH → Transactions → « Paiement des salaires » (`/hr/payments` : lots, fichier, retours ; formats de fichier).
  API : `/api/v1/hr/payments/*`, `/api/v1/hr/payroll/runs/{id}/payment-status`.
- Test : `PaieReglesVersionneesIT.paiementDesSalaires` (RIB manquant nommé, double lot refusé, approbation par le
  préparateur refusée, fichier ligne à ligne avec valeur entre guillemets, empreinte stable, annulation après émission
  refusée, 422 débité / 521 crédité de 90 000 pour le seul payé, mouvement de trésorerie, lot clôturé, rejet repayé
  dans un nouveau lot) ; `HrPayments.test.tsx` (encodages, préparation, retours).
- Restent : import du fichier de retour de la banque (aujourd'hui saisi ligne à ligne ou « tout payé ») ; formats XML
  (ISO 20022) si une banque l'exige ; virements dans une autre devise que celle de la paie.

## F. Limites et décisions en attente

- **Décision du propriétaire** : la méthode par défaut des sociétés existantes est « jours calendaires » ; un cabinet
  paie burkinabè peut préférer le mois de 30 jours. La changer retire la confirmation des barèmes.
- **Validation réglementaire** (aucune valeur saisie par QERP) : taux et plafonds CNSS, tranches et abattements IUTS,
  charges de famille, contribution patronale, fonds de soutien patriotique, déclarations. Chaque valeur doit être
  saisie et confirmée par la personne habilitée, avec sa référence officielle, et comparée à des bulletins de
  référence vérifiés avant production.
- **Non déployé** : V148 à V151 ne sont appliquées ni sur `qerp_reel` ni sur Supabase (`deploy-supabase.sh` après
  accord). Exécution à blanc réussie sur la base de développement ; tests d'intégration verts (voir ci-dessous).
- P1 terminé. Restent P2 (absences, congés et heures supplémentaires ; paiement des salaires ; import RH avec
  simulation ; historique des rubriques et barèmes ; pièces jointes sur mouvements ; analytique de l'écriture de paie)
  et P3 (déclarations CNSS / IUTS, cumuls annuels, autres pays).
- La contrepassation appelle `reverse_journal_entry`, qui garde ses propres contrôles (droits comptables, période
  ouverte) : un gestionnaire de paie sans droit comptable peut devoir passer par un comptable.
- Le plafond d'une cotisation n'est pas proratisé pour un mois incomplet (entrée / sortie) : à confirmer selon la règle
  de l'organisme.

Vérifications du 25 nov. 2026 (JDK 25, PostgreSQL 18.6 Testcontainers) : `PaieProrataPresenceIT` 3/3,
`PaieReglesVersionneesIT` 4/4, `EtatsParRubriquesIT` 8/8, `HrApiIT` 15/15, `SchemaMigrationIT` 7/7,
`AuthorizationsApiIT` 6/6, `IsolationSocietesIT` 4/4, `RolesDesModulesIT` 4/4, `RhReferentielsIT` 3/3,
`OpenApiContractIT` 3/3 (contrat régénéré) ; `npm run api:check`, `db:check-twins` (135 paires), TypeScript, Vitest
des écrans RH (32 tests).
