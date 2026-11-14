# 12 — Plan comptable multi-référentiels : audit de l'existant, architecture proposée, plan

Demande du propriétaire (14 nov. 2026) : faire du plan comptable un système flexible, configurable et
multi-référentiels (SYSCOHADA, OHADA, PCG, plans personnalisés), inspiré de Sage 300, Sage X3 et SAP ;
gestion des droits et rôles incluse. **Ce document précède toute modification de code** : rien n'est
implémenté avant validation.

Références : SAP (plan de comptes opérationnel / plan de groupe / plan pays, fiche compte « niveau plan »
et « niveau société », groupes de comptes, champs obligatoires par groupe, comptes collectifs « reconciliation
accounts », versions d'états financiers), Sage X3 (plusieurs plans par référentiel, modèles de plan, comptes
collectifs, sections analytiques par compte, codes de correspondance), Sage 300 (structures de compte par
segments, groupes de comptes, import / export par modèles). Règles : AUDCIF / SYSCOHADA révisé, PCG.

## 1. Audit de l'existant (base à V61, 14 nov. 2026)

### 1.1 Ce qui existe et se réutilise

| Élément | Où | État |
|---|---|---|
| Comptes de la société | `gl_accounts` (code, intitulé, type, parent, actif, regroupement, remplacé par) | 🟢 un seul plan par société, implicite |
| Protection du plan | V60 : droit `accounting.chart`, code et type figés si mouvementé, parent par préfixe, pas d'imputation sur compte inactif ou de regroupement | ✅ |
| Référentiel de démarrage | `accounting_frameworks` (code, nom, portée, version, validé), `accounting_framework_accounts`, `accounting_framework_role_defaults`, `apply_accounting_framework` | 🟢 SYSCOHADA seul, 11 comptes ; idempotent, n'écrase jamais |
| Référentiel de contrôle | V60 : `syscohada_reference_accounts` (classes, 2 chiffres, principaux sous-comptes), `syscohada_keyword_hints` | 🟢 propre à SYSCOHADA (nom de table) |
| Contrôle et corrections | V60–V61 : `chart_of_accounts_issues`, `replace_gl_account`, `reclassify_gl_account_balance`, `create_syscohada_headings`, `link_gl_account_parents` ; écran `ChartOfAccountsAudit` | ✅ |
| Imputations automatiques | `posting_roles` (+ `expected_prefixes` V60), `tenant_posting_accounts`, `posting_account()` / `require_posting_account()` (QG001) | ✅ découplées des numéros |
| TVA | `tax_codes.gl_account_id` | 🟢 lien code TVA → compte, pas compte → TVA par défaut |
| Analytique | `analytic_axes`, `analytic_values`, `analytic_rules` (obligatoire / interdit par **préfixe** de compte), `journal_line_analytics` | ✅ |
| Journaux et numérotation | `accounting_journals`, `journal_for_source`, pièces et lots (V38) | ✅ indépendants du plan |
| Isolation des sociétés | V55 : toute référence à un compte d'une autre société refusée | ✅ |
| Droits | catalogue `module.action`, rôles système et personnalisés, `has_permission`, écran Rôles et autorisations | ✅ réutilisable tel quel |
| Import | fonction Edge `import-data` (gl_accounts : code, intitulé, type, actif), modèle CSV `import-templates.ts`, page `/admin/import` | 🟡 import plat, sans parent, sans aperçu ni rapport d'erreurs |
| Écran | `/journal/master-data` (`GLMasterData` : arbre, fiche, création, modification, désactivation) | 🟢 |

### 1.2 Constats bloquants pour un plan multi-référentiels

| # | Constat | Effet |
|---|---|---|
| C-1 | **Un seul plan par société**, sans objet « plan » ni version | Impossible d'avoir SYSCOHADA + plan de groupe, ni de dater un changement de référentiel |
| C-2 | **États financiers calculés par préfixes de code** : `gl_sig_view` (SIG : 70 = ventes, 60 = achats…) et les classes dans les rapports | Un plan non SYSCOHADA (ou mal numéroté) donne des états faux : chez ROXGOLD SANGO, ventes en 4000 → **ventes SIG = 0** |
| C-3 | Paie : comptes **codés en dur** (4210, 4310, 4470, 6610, 6630 dans `post_payroll_run`) | Hors imputations automatiques par rôle ; faux en SYSCOHADA (431 ≠ TVA, etc.) |
| C-4 | Contrôles analytiques par **préfixe** de compte | Liés à la numérotation : à rattacher aussi à un attribut du compte |
| C-5 | Type limité à 5 valeurs, pas de **sens normal** (débit / crédit), pas de **nature** (collectif, auxiliaire, regroupement, bilan / gestion) | Contrôles de solde anormal et comptes collectifs impossibles |
| C-6 | Pas de **comptes collectifs** : les sous-ledgers (clients, fournisseurs) passent par rôle, mais rien n'interdit une OD manuelle directe sur 411 / 401 | Balance auxiliaire ≠ général possible (SAP / Sage l'interdisent) |
| C-7 | Pas d'**historique** des modifications de comptes (hors fiche fournisseur V56) | Piste d'audit incomplète |
| C-8 | Référentiel de contrôle **propre à SYSCOHADA** (noms de tables), règles du référentiel dans des fonctions SQL | Ajouter le PCG demanderait du code : contraire à « règles séparées du code » |
| C-9 | Import plat, sans profils, correspondances de colonnes, aperçu, contrôles ni rapport | Reprise d'un plan Sage / SAP longue et risquée |
| C-10 | Aucun objet de **correspondance** entre référentiels | Pas de conversion SYSCOHADA ↔ Sage ↔ SAP, ni de plan de groupe |

### 1.3 Diagnostic du plan de ROXGOLD SANGO (production, V60)

35 comptes, **23 erreurs et 14 points à revoir** ; 6 comptes portent des écritures (4000, 4010, 4110, 4320, 5210, 6010).

| Anomalie | Comptes | Correction SYSCOHADA proposée |
|---|---|---|
| Trésorerie et clients en classe 1 | 1000 et 1030 Caisse (doublon), 1020 et 1100 Banques, 1110 et 1200 Clients (doublon de 4110), 1120 Créances douteuses | 571, 521, 411, 416 |
| Codes hors plan (classe 20, 30) | 2000 Fournisseurs (doublon de 4010), 2010 Immobilisations corporelles, 2020 incorporelles, 3010 et 3020 Stocks | 401, 24x, 21x, 311, 321 |
| Produits et dettes mal classés en classe 4 | **4000 Ventes de marchandises (mouvementé, imputation automatique des ventes)**, 4020 Produits financiers, 4120 Dettes fiscales, 4130 Dettes sociales | **701**, 771, 44x, 43x |
| TVA sur des comptes d'organismes sociaux | 4310 TVA collectée (431 = sécurité sociale), **4320 TVA déductible (mouvementé)** | **4431**, **4452** |
| Intitulés hors de leur compte SYSCOHADA (classe 6 / 7) | 6000 et 6110 Charges de personnel (doublon), 6100 Loyers et 6120 Charges locatives (61 = transports), 6130, 6210 et 6220 Dotations (62 = services extérieurs), 6310 Charges financières, 7100 Prestations (71 = subventions) | 661, 622, 638, 681, 691, 671, 706 |
| Doublon de ventes | 7000 et 4000 Ventes de marchandises | 701 unique |

Correction possible dès maintenant, par l'écran « Contrôle SYSCOHADA », sans rien supprimer ni modifier des
écritures passées : remplacer chaque compte (imputations automatiques redirigées), puis reclasser par OD le
solde de 4000 → 701 et 4320 → 4452. **Non appliquée : demande votre accord et celui de l'expert-comptable**
(décision D4 de la feuille de route).

## 2. Architecture fonctionnelle proposée

Principe directeur : **les règles comptables sont des données, pas du code**. Un référentiel (SYSCOHADA,
PCG, plan Sage, plan SAP, plan de groupe) décrit sa structure, ses comptes modèles, ses règles de contrôle,
ses rubriques d'états et ses correspondances ; le moteur ne connaît aucun numéro de compte.

```
Référentiel (framework) ──versions──► Modèle de plan (comptes modèles, règles, rubriques d'états)
        │                                     │ instancier (copie, jamais lien vivant)
        ▼                                     ▼
Correspondances entre référentiels    Plan de la société (chart) ──versions datées──► Comptes
        │ (validées, jamais appliquées                          │
        │  automatiquement aux comptes)                         ├─ imputations automatiques (rôles → comptes)
        ▼                                                       ├─ codes TVA, règles analytiques (par attribut)
Plans de groupe / exports Sage, SAP                             └─ écritures (inchangées)
```

1. **Référentiels et modèles** : un référentiel a des versions (date d'application, statut brouillon / publié /
   archivé). Livrés : SYSCOHADA révisé (complet, à valider par l'expert-comptable), PCG ; plans
   personnalisés créés par copie ou de zéro.
2. **Plans** : une société a **un plan opérationnel** (celui des écritures) et peut avoir des **plans
   secondaires** (plan de groupe, plan fiscal, plan Sage / SAP pour l'échange) alimentés par correspondance.
   Un plan se crée depuis un modèle, se duplique, s'active, s'archive ; il est versionné (date d'effet).
   Un modèle se réutilise dans plusieurs sociétés (copie, jamais lien vivant : chaque société reste maîtresse).
3. **Comptes configurables** : code libre (aucune structure de numérotation imposée ; la longueur et les
   segments éventuels sont une règle du référentiel), intitulé (et intitulé court, traductions), type
   (catégorie configurable par référentiel, mappée sur les 5 natures du bilan / compte de résultat), sens
   normal, nature (regroupement, mouvement, collectif, auxiliaire), autorisations (imputation manuelle,
   automatique seulement, lettrable, analytique obligatoire / interdite / facultative), TVA par défaut,
   devise (monodevise ou toutes devises), attributs personnalisés.
4. **États financiers par rubriques** : bilan, compte de résultat, SIG, TAFIRE / tableau des flux définis
   comme rubriques du référentiel, alimentées par **affectation des comptes** (règles par intervalle ou
   attribut, éditables) — plus jamais par préfixe codé dans une vue (C-2).
5. **Correspondances** : table d'appariement compte source → compte cible (1-1, n-1, 1-n avec clé de
   répartition), par paire de plans, statut proposé / validé / refusé, proposition automatique (même code,
   intitulé proche, indices) **jamais appliquée sans validation** ; utilisées pour l'export Sage / SAP, le plan
   de groupe et la migration de plan.
6. **Migration de plan** (changement de référentiel) : plan cible + correspondances validées → remplacement des
   imputations automatiques et reclassement des soldes à une date (écritures OD nouvelles), comme V60 compte
   par compte, mais en lot ; l'historique reste dans l'ancien plan, consultable.
7. **Import / export guidé** : profils réutilisables (format, séparateur, feuille, correspondance des colonnes,
   transformations : code Sage « 411000 » → « 411 », type depuis la classe…), modèles téléchargeables
   (SYSCOHADA complet ou partiel, Sage 300, Sage X3, SAP), étapes : fichier → correspondances → **aperçu
   contrôlé** (doublons, codes invalides, parents manquants, types incohérents, anomalies du référentiel) →
   correction en ligne ou fichier d'erreurs → validation (import en transaction, tout ou rien) ; export CSV,
   Excel, format Sage / SAP via correspondances.
8. **Qualité et historique** : tableau de bord de qualité (généralisation de `chart_of_accounts_issues` à tout
   référentiel, par règles), journal de chaque modification de compte (avant / après, auteur, motif).
9. **Multi-sociétés** : chaque société a ses plans, paramètres, devise et législation (référentiel par pays) ;
   l'isolation stricte (V55) s'applique ; aucun flux inter-sociétés ; la consolidation reste en lecture.

## 3. Modèle de données proposé (évolutif, compatible avec l'existant)

| Table | Rôle | Clés et contraintes |
|---|---|---|
| `accounting_frameworks` (existante) | Référentiel : SYSCOHADA_REVISE, PCG_2025, SAGE_X3_MODEL, SAP_YCOA, GROUPE… | + `kind` (légal / ERP / groupe / personnalisé), `country`, `owner_tenant_id` (NULL = public) |
| `framework_versions` | Version datée d'un référentiel | (framework, version), `effective_from`, statut |
| `framework_accounts` (extension de `accounting_framework_accounts`) | Comptes modèles d'une version | + niveau, parent, nature, sens, catégorie, attributs |
| `framework_rules` | Règles du référentiel en données : longueur et motif de code, type attendu par intervalle, comptes collectifs, analytique, TVA | évaluées par un moteur générique (remplace les fonctions SYSCOHADA en dur) |
| `account_categories` | Catégories configurables par référentiel → nature (actif, passif, capitaux, charge, produit, hors bilan) | |
| `report_layouts` / `report_lines` / `report_line_accounts` | États financiers par rubriques et affectations | remplace les préfixes de `gl_sig_view` |
| `charts` | Plan d'une société : opérationnel ou secondaire, référentiel et version d'origine, statut (brouillon, actif, archivé), date d'effet | un seul plan opérationnel actif par société et date |
| `gl_accounts` (existante) | Compte d'un plan | + `chart_id`, `normal_balance`, `nature` (header / posting / control / sub), `category_code`, `posting_mode` (manuel / automatique seulement / interdit), `reconcilable`, `analytic_policy`, `default_tax_code_id`, `currency_mode`, `custom_attributes jsonb` ; contraintes existantes conservées |
| `account_attribute_definitions` | Attributs personnalisés par société (nom, type, liste de valeurs, obligatoire) | valide `custom_attributes` |
| `gl_account_history` | Journal des modifications (avant / après, auteur, motif) | écrit par déclencheur |
| `chart_mappings` / `chart_mapping_lines` | Correspondances entre deux plans ou référentiels | statut par ligne, auteur, validateur |
| `import_profiles` / `import_runs` / `import_run_rows` | Profils, exécutions, lignes avec erreurs et corrections | importation en deux temps : préparation puis validation |

Compatibilité : la migration crée un plan opérationnel par société et y rattache tous ses comptes existants
(`chart_id`), sans changer un code, un compte, une écriture ni une imputation ; les vues d'états basculent
vers les rubriques en conservant les résultats actuels pour un plan SYSCOHADA conforme (tests de
non-régression sur `gl_trial_balance`, `gl_ledger_detail`, `gl_sig_view`).

## 4. Droits et rôles (catalogue, attribuables à tout rôle)

Méthode V57–V59 : chaque action est un droit du catalogue, accordé par défaut aux rôles indiqués, modifiable
dans Paramètres → Rôles et autorisations ; la base l'applique (RLS + fonctions), l'écran ne fait qu'afficher.

| Droit | Action | Par défaut |
|---|---|---|
| `accounting.chart_view` | Consulter plans, comptes, historique, qualité | tous les rôles comptables, auditeur, lecteur |
| `accounting.chart` (existant) | Créer / modifier des comptes du plan opérationnel | administrateur, comptable |
| `accounting.chart_admin` | Créer, dupliquer, activer, archiver un plan ; changer de plan opérationnel | administrateur |
| `accounting.frameworks` | Créer / publier un référentiel ou un modèle de la société | administrateur |
| `accounting.mapping` | Proposer des correspondances | comptable |
| `accounting.mapping_validate` | Valider des correspondances (**autre personne que l'auteur**, double contrôle comme V56) | administrateur, chef comptable |
| `accounting.import` | Préparer un import | comptable |
| `accounting.import_validate` | Valider l'import préparé (séparation des tâches) | administrateur, chef comptable |
| `accounting.reclassify` | Reclasser des soldes (OD de migration) | chef comptable |
| `accounting.export` | Exporter plans et correspondances | comptable, auditeur |

Règles liées aux droits : séparation préparation / validation (import, correspondances, migration) ; motif
obligatoire pour les opérations sensibles ; historique de toute modification ; le compte d'une autre société
reste inaccessible (V55) ; un référentiel « public » (SYSCOHADA livré) n'est modifiable que par la
plateforme, une société le copie pour l'adapter.

## 5. Écrans proposés (réutilisant les composants existants)

| Écran | Contenu | Réutilise |
|---|---|---|
| Comptabilité → Données de base → **Plans comptables** | Liste des plans de la société (opérationnel, secondaires), statut, version, actions créer depuis un modèle / dupliquer / activer / archiver | onglets standard, `DataTableControls` |
| **Comptes** (existant, enrichi) | Arbre hiérarchique, recherche et filtres (classe, nature, catégorie, attribut, statut, mouvementé), création et modification rapide, fiche complète, historique | `GLMasterData`, `TreeItem` |
| **Qualité du plan** | Tableau de bord : erreurs, avertissements, comptes sans mouvement, doublons, conformité au référentiel, corrections guidées | `ChartOfAccountsAudit` (V60) |
| **Importation guidée** | 5 étapes : fichier → profil et colonnes → aperçu contrôlé → corrections → validation ; profils, rapport d'erreurs téléchargeable | page `/admin/import`, `exportToCSV` |
| **Correspondances** | Paire de plans, proposition automatique, validation ligne à ligne, export | `DocumentDetail`, actions groupées |
| **Comparaison de plans** | Deux plans côte à côte : comptes manquants, intitulés ou types différents, correspondances | |
| **Référentiels** (Paramètres) | Versions, règles en données, rubriques d'états | `/settings` (onglets Comptabilisation existants) |

## 6. Plan d'implémentation (lots, chacun testé de bout en bout, rien de cassé)

| Lot | Contenu | Prérequis | Risque maîtrisé par |
|---|---|---|---|
| **PC-0** | Décisions : corrections de ROXGOLD (§1.3), référentiels à livrer (SYSCOHADA complet, PCG), plan de groupe éventuel | votre validation, expert-comptable | — |
| **PC-1** ✅ V62 | Objet `charts` + rattachement des comptes existants ; attributs de compte (sens, nature, mode d'imputation, TVA par défaut, analytique, attributs personnalisés) ; historique des modifications ; droits §4 | V60 | tests de non-régression sur écritures, imputations, analytique |
| **PC-2** ✅ V63 | États par rubriques (bilan, compte de résultat, SIG) affectés par règles ; `gl_sig_view` reconstruite dessus ; correction de la paie par rôles (C-3) | PC-1 | comparaison avant / après sur la copie des données réelles |
| **PC-3** ✅ V64 | Référentiels versionnés et règles en données ; SYSCOHADA révisé complet, PCG ; moteur de qualité générique (remplace les fonctions propres à SYSCOHADA) | PC-1 | jeux d'essai par référentiel |
| **PC-4** | Import guidé, profils, modèles (SYSCOHADA, Sage 300, Sage X3, SAP), aperçu, rapport d'erreurs, validation par un tiers ; exports | PC-3 | import en transaction, tout ou rien |
| **PC-5** | Correspondances, comparaison de plans, plans secondaires, export Sage / SAP | PC-3 | jamais d'application sans validation |
| **PC-6** | Migration de plan opérationnel (lot de remplacements + reclassements datés) ; modèles réutilisables entre sociétés | PC-5 | simulation obligatoire, OD nouvelles uniquement |

## 7. Décisions attendues

| # | Question | Proposition |
|---|---|---|
| D-PC1 | Appliquer les corrections du plan ROXGOLD (§1.3) maintenant, avec l'outil V60 ? | Oui après revue de l'expert-comptable ; je prépare la liste exacte et la simulation des reclassements |
| D-PC2 | Référentiels à livrer en premier | SYSCOHADA révisé complet (système normal), puis PCG ; plans Sage / SAP comme modèles d'import |
| D-PC3 | Plan de groupe / consolidation | Plan secondaire alimenté par correspondances, lecture seule |
| D-PC4 | Ordre des lots | PC-1 → PC-2 (corrige des états aujourd'hui faux) → PC-3 → PC-4 → PC-5 → PC-6 |
