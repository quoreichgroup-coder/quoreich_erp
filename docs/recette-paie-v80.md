# QUOREICH — PV technique provisoire de la paie V80

Date : 15 novembre 2026. Statut : **travaux locaux ; lot non réceptionné**.

Ce PV reprend la méthode des [recettes du Lot 1](recette-lot1.md) et du [Lot 2](recette-lot2.md) : les contrôles sont séparés par niveau et les réserves restent visibles. Il ne vaut ni recette métier/fiscale ni autorisation de déploiement.

## Périmètre V80

- Paramètres de paie par société : pays, devise, taux salarié et employeur, plafonds, tranches marginales, date d'effet et référence officielle.
- Confirmation explicite des règles ; toute modification retire cette confirmation.
- Calculs exclusivement depuis des règles confirmées ; photographie complète conservée sur chaque cycle.
- Vérification de devise, date d'effet, période `AAAA-MM`, comptes de comptabilisation par rôle, verrouillage des cycles pendant génération/comptabilisation.
- Département photographié dans chaque ligne à la génération, pour stabiliser les rapports après modification du dossier salarié. Les anciennes lignes sans photographie sont classées comme affectation historique inconnue.
- RPC de calcul unitaire réservé aux personnes autorisées à consulter ou créer la paie.
- Aucun taux légal n'est prérempli ; les cycles antérieurs sans photographie V80 restent non vérifiables.

## Résultats des contrôles

| Niveau | Résultat | Limite |
|---|---|---|
| Vitest complet | **83 fichiers, 543 tests réussis** | Exécuté avec une configuration temporaire sans le plugin SWC, supprimée après le test. Inclus : paramètres (5), aperçu export/devise/masquage (2), lecture du bon journal de cycle avec filtre de droit/utilisateur (1) et pagination/format numérique des PDF. |
| Vitest ciblé avant le test UI | **3 fichiers, 32 tests réussis** | Moteur de paie, filtres RH et périodes des états financiers ; tous inclus aussi dans la suite complète. |
| TypeScript | `tsc --noEmit` réussi | — |
| ESLint ciblé | **0 erreur** | `no-explicit-any` restant sur les appels Supabase typés dynamiquement dans les paramètres et hooks de paie; les exports documentaires ciblés passent sans avertissement. |
| Build web | **Échec environnemental** | Vite ne charge pas sa configuration car le binaire natif `@swc/core` est absent; le cache SWC local est inaccessible. TypeScript et Vitest passent. |
| Migrations jumelées | **65 paires V16–V80 identiques** | `npm run db:check-twins` vérifie contenu et ordre des migrations local/Supabase. |
| Intégration Java/PostgreSQL ciblée | **Réussie** | Java 25.0.5 / PostgreSQL 18.6 : `EtatsParRubriquesIT` et `SchemaMigrationIT` passent; 14 tests, 0 échec. |
| Vérification Java complète | **Réussie** | `mvnw verify` : 11 tests unitaires + 190 tests d'intégration, 0 échec/erreur; V80 est aussi rejouée dans les bases PostgreSQL éphémères. |
| PostgreSQL Supabase | Migration V80 appliquée avec `scripts/schema/deploy-supabase.sh`; version PostgreSQL 17.11 | Le journal `qerp_deploy.applied_migrations` contient la jumelle V80; `payroll_run_audit` existe et `payroll_register_view` conserve `security_invoker=true`. |
| PostgreSQL local on-premise | Migration V80 appliquée par Flyway à `qerp_reel`, PostgreSQL 18.6, `127.0.0.1:54433` | `flyway_schema_history` est en V80; `payroll_run_audit` existe et `payroll_register_view` conserve `security_invoker=true`. Sauvegarde pré-migration vérifiée : `QERP-backups/qerp_reel_pre_v80_20261115.dump`. |

Les deux bases réelles sont maintenant en V80. La migration locale a été précédée d'un dump personnalisé relu avec `pg_restore -l`; le script Supabase a contrôlé les jumelles et n'a appliqué que la migration V80 manquante. L'API locale a démarré et son endpoint santé a répondu `UP`.

## Réserves avant réception

1. Faire vérifier les taux, plafonds, tranches, comptes et références légales par un expert-comptable/fiscaliste pour chaque pays activé; aucun barème légal n'est prérempli.
2. Recetter les règles confirmées sur des bulletins témoins et contrôler calcul, approbation, comptabilisation, rôles et RLS par société.
3. Refaire le build web et les parcours UI; ouvrir et imprimer les exports sous des rôles distincts, vérifier pagination, devise et masquage des champs sensibles.
4. Documenter le résultat métier et signer la recette avant d'annoncer la V80 comme réceptionnée.

**Critère de sortie : non atteint.** Les tests Java complets passent et les deux bases sont en V80; la validation des barèmes par pays et la recette métier/UI restent obligatoires.

## États, impressions et exports

- Le registre mensuel de paie, les cycles et l'annuaire utilisent les lignes/dossiers réellement chargés et les filtres visibles. Le département est maintenant photographié à la génération de la paie; les lignes historiques sans photographie sont signalées « inconnue ». Les écrans concernés proposent Excel (`.xlsx`), CSV et PDF ; le registre possède aussi une mise en page d'impression A4 paysage avec pied de page paginé. Les tableaux PDF répètent leurs en-têtes et évitent de couper une ligne entre deux pages; les PDF génériques et récapitulatifs de cycle affichent les pages numérotées et les nombres selon les séparateurs français. Les fichiers Excel stockent les montants comme nombres et appliquent le groupement des milliers.
- Les montants de paie et salaires restent masqués à l'export si le rôle n'a pas `view_sensitive`; l'export nécessite le droit central `export`. Les rapports incluent période et devise et ne cumulent pas de devises différentes.
- Le contrôle de cohérence du fichier PDF/Excel généré et de l'impression physique reste à faire dans un navigateur avec une recette UI avant réception.

Les références consultées ont servi de repères de présentation et de filtrage, sans copier de logique légale : [Sage 300 — impression des rapports](https://help.sage300.com/en-us/2026/web/Content/Reports/ReportPrintingOptions.htm), [Sage 300 Payroll — historique des transactions](https://help.sage300.com/en-us/2024/classic/Subsystems/UP/Content/Reports/Employee/UsingtheTransactionHistoryReport.htm), [Sage 300 People — analyse de paie](https://za-kb.sage.com/portal/app/portlets/results/botviewsolution.jsp?hypermediatext=null&solutionid=200610114010027), [Sage 300 People — traitement d'un paiement](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=1&q=acb&solutionid=200411085450331), [Sage 300 People — impression des bulletins](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=200410151812476&view=print), [SAP — rapports de paie](https://help.sap.com/docs/HR_RENEWAL/efa1f379fd8b4ff6b825f5105cbc27e5/cc92e0535e56424de10000000a174cb4.html?version=1.4.latest), [Sage X3 — fonctions financières et reporting](https://www.sage.com/en-us/sage-business-cloud/sage-x3/product-capabilities/financial/).

## Backlog de réception Paie/RH

1. **Validation métier V80** : faire saisir et confirmer par entité/pays les taux, plafonds, tranches, références juridiques et comptes de paie ; comparer des cas de paie et leurs écritures avec des paies témoins validées par l'expert local.
2. **Recette UI V80** : générer, ouvrir et imprimer les registres et récapitulatifs de cycle sur données réelles; vérifier feuilles Excel, séparateurs CSV, pagination A4, devises et masquage des champs sensibles avec des rôles distincts.
3. **Paiement effectif des salaires** : après comptabilisation, créer un lot d'ordres de paiement par salarié, produire les fichiers bancaires selon le format configuré par banque/pays, suivre accepté/rejeté/payé, puis comptabiliser et rapprocher le règlement du compte de dette défini par le rôle comptable (par exemple 422 sous SYSCOHADA). Aujourd'hui `post_payroll_run` crée la dette de paie; l'application ne suit pas encore les transferts bancaires. Sage documente un paiement et un rapport de paiement séparés; les formats bancaires ont leurs champs et règles propres, donc aucun format générique ne doit être présumé.
5. **Bulletins individuels** : produire un bulletin imprimable par salarié et période, avec détail des gains/retenues/net/devise et règles appliquées; gérer accès individuel et réédition contrôlée. L'export actuel récapitule un cycle, il ne remplace pas le bulletin individuel.
6. **Lot RH suivant** : créer de vrais mouvements horodatés de personnel (entrée, changement de poste/salaire/département, suspension, sortie) avec historique/audit. Aujourd'hui l'annuaire permet la mise à jour du dossier courant mais ne fournit pas encore un historique de mouvements RH; les cycles V80 conservent désormais uniquement l'affectation départementale au calcul.
7. **Lots RH suivants** : évaluer puis spécifier présence/temps, congés, heures supplémentaires, primes/variables et leur incidence sur la paie, en tenant compte du pays et des rôles. Le module ne doit pas les présenter comme pris en charge tant que le flux métier et ses contrôles ne sont pas livrés.
8. **Intégration métier** : contrôler la couverture de la paie dans les rapports globaux et les contrôles de budget; les notes précédentes signalent que le contrôle des notes de frais et de la paie n'est pas encore implémenté.
9. **Référentiels RH** : centraliser dans Paramètres les types de contrat, statuts, motifs de mouvement et catégories de rémunération; remplacer le champ libre actuel au moment de livrer ces listes configurables.

## Journal des cycles

La migration V80 journalise la création, la génération des lignes, l'approbation, la comptabilisation, les changements de statut et la suppression d'un cycle. Les rôles clients ne peuvent qu'en lire les événements; la RLS contrôle société et droit d'audit. Le registre RH garde explicitement `security_invoker=true`. Les deux bases réelles sont en V80 et les tests Java complets passent; les parcours RH restent cependant incomplets (pas de mouvements datés, composantes détaillées, bulletin individuel ni paiement bancaire).
