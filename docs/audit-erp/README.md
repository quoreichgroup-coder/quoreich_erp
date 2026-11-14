# QUOREICH ERP — Audit des processus métier (14 novembre 2026)

Audit fonctionnel, métier, technique et documentaire demandé par le propriétaire. **Aucune correction n'a été faite** : ce dossier est un rapport à valider avant toute implémentation.

## Méthode et niveau de preuve

L'existant a été inspecté **dans son implémentation réelle**, pas d'après les menus :

| Source | Ce qui a été lu ou exécuté |
|---|---|
| Base de données | Copie des données réelles `qerp_reel` (V41, identique à Supabase par les migrations jumelles) : 135 tables, déclencheurs, fonctions, politiques RLS, droits, index uniques |
| Sondes d'écriture | 18 essais d'écriture en tant qu'**utilisateur « Lecteur »** (rôle `viewer`) de deux sociétés, chacun dans une transaction **annulée** (ROLLBACK) : rien n'a été modifié. Référencés **[S1]…[S18]** |
| Code | 112 pages React, hooks, API Java (`services/api`, paquets `customer`, `invoice`, `accounting`, `analytics`, `authorization`) |
| Tests exécutés (session du 14 nov.) | Java 128 tests verts ; parcours nuage 13/13 ; parcours sur site 2/2 ; Vitest 450 tests |

Légende utilisée dans tous les livrables :

- ✅ **Implémenté et prouvé** par un test exécuté (IT Java ou parcours de bout en bout).
- 🟢 **Implémenté**, vérifié par lecture du code, sans test de bout en bout.
- 🟡 **Partiel** : existe mais incomplet ou contournable.
- 🔴 **Défectueux** : existe mais produit un résultat faux ou ne peut pas fonctionner.
- ⚪ **Absent**.
- 🧮 **À valider par un expert-comptable / fiscaliste** (règle propre au pays).

## Livrables

| # | Fichier | Contenu |
|---|---|---|
| 01 | [01-cartographie-processus.md](01-cartographie-processus.md) | Modules, processus, dépendances, ce qui est réel ou simulé |
| 02 | [02-analyse-des-ecarts.md](02-analyse-des-ecarts.md) | Tableau des écarts : module, processus, problème, impact, gravité, priorité |
| 03 | [03-regles-metier.md](03-regles-metier.md) | Règles métier testables, état actuel de chacune |
| 04 | [04-cycle-de-vie-des-documents.md](04-cycle-de-vie-des-documents.md) | Pièces : source, statuts, approbation, impact stock et comptable, pièce suivante |
| 05 | [05-integration-comptable.md](05-integration-comptable.md) | Événement → débit / crédit, d'après le paramétrage réel |
| 06 | [06-plan-ui-ux.md](06-plan-ui-ux.md) | Écrans, formulaires, navigation |
| 07 | [07-revue-architecture-technique.md](07-revue-architecture-technique.md) | Architecture, sécurité, transactions, intégrations |
| 08 | [08-plan-de-tests-e2e.md](08-plan-de-tests-e2e.md) | Scénarios, données, résultats attendus, preuves |
| 09 | [09-feuille-de-route.md](09-feuille-de-route.md) | Recommandations classées P0 → P3, plan progressif |
| 10 | [10-inventaire-ventes-clients.md](10-inventaire-ventes-clients.md) | CRUD et actions groupées, écran par écran, ventes et comptes clients |

## Synthèse pour la direction

**Ce qui tient :** l'isolation entre sociétés au niveau des lectures, le modèle d'autorisations central, le calendrier fiscal, la chaîne achats → réception → facture fournisseur → paiement (V34–V41, prouvée de bout en bout avec séparation des tâches et rapprochement à 3 voies), la facture client à lignes et sa comptabilisation, les journaux, numéros de pièce et lots (V38).

**Ce qui ne tient pas — 8 anomalies P0 prouvées :**

1. **Écriture entre sociétés** [S13] : un simple lecteur de la société A enregistre un paiement sur une facture de la société B ; la facture de B passe « partiellement payée » et une écriture est créée dans A.
2. **Paiements supprimables et modifiables par un lecteur** [S3, S4] : la facture redevient impayée, l'écriture bancaire reste → client, banque et grand livre divergent.
3. **Factures clients émises modifiables et annulables par un lecteur** [S1, S12] sans avoir ni contre-passation : le grand livre garde l'ancienne écriture.
4. **Piste d'audit comptable effaçable** par un lecteur [S6] (`gl_audit_logs`, 20 lignes supprimées dans l'essai).
5. **Stock modifiable directement** (quantité, coût moyen) et mouvements de stock saisis par un lecteur [S14, S18].
6. **Livraison client : stock décrémenté deux fois** (mise à jour directe + mouvement « posted » appliqué par déclencheur), au coût 0, donc sans coût des ventes — même défaut que celui corrigé côté réception en V34.
7. **Facturation depuis la livraison** (`invoice_from_delivery`, `auto_invoice_on_delivery`) : **TVA forcée à 0**, numéro **aléatoire** (contourne la numérotation légale V22 et peut entrer en collision), sans lignes.
8. **Budget : la commande est imputée en « réalisé »** (pas en engagement), deux fois si elle passe d'« approuvée » à « commandée », jamais libérée à l'annulation, sur le premier budget trouvé.

**Fonctions métier indispensables absentes (P1) :** avoirs clients et fournisseurs, acomptes, retours, lettrage, rapprochement bancaire relié aux règlements, multi-devise, caisse distincte de la banque, états financiers au format SYSCOHADA, impression officielle des pièces (Lot 6), demande de prix (RFQ).

**Modules comptables cassés par du code obsolète (P1) :** dotations aux amortissements et cessions d'immobilisations (`post_monthly_depreciation`, `post_asset_disposal`) écrivent dans des colonnes qui n'existent pas (`journal_entries.reference`, `journal_lines.journal_entry_id`) et ne vérifient ni la société ni les droits ; paie et stock comptabilisés par des numéros de comptes codés en dur.

**Points à faire trancher par un expert-comptable 🧮 :** le paramétrage de ROXGOLD SANGO envoie la TVA collectée au compte **4310** (classe 43 = organismes sociaux en SYSCOHADA) et les ventes au compte **4000** (classe 4 = tiers) ; le taux de charges patronales 16,4 % est codé en dur dans la paie.

La feuille de route (09) propose de traiter les P0 en **un seul lot court de sécurisation (V42–V44)** avant de reprendre les fonctions manquantes, sans réécriture et sans migration destructive.
