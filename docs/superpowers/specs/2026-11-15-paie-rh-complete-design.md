# Conception de livraison RH et paie

## Intention

Finaliser le module RH/Paie de QERP pour que les salariés, mouvements, calculs, validations, paiements, rapports, impressions et paramètres fonctionnent avec des données persistées sur Supabase comme sur la base PostgreSQL on-premise. Le module doit être exploitable avant la recette utilisateur, avec des contrôles d'accès appliqués côté serveur et des tests sur PostgreSQL.

## État vérifié

- Les bases Supabase et `qerp_reel` sont en V80. Les 11 tests unitaires et 190 tests d'intégration Java passent; les 543 tests Vitest et `tsc --noEmit` passaient lors du précédent contrôle.
- Le dossier employé est une ligne courante seulement. `useUpsertEmployee` remplace directement le dossier; aucun historique effectif-daté des changements n'est persisté.
- Le calcul paie enregistre un total brut, retenues, impôts, net et charges par salarié. Il n'existe pas de lignes de gains/déductions explicites nécessaires à un bulletin détaillé.
- `post_payroll_run` crée l'écriture comptable et la dette salariale. Le module ne crée pas d'ordres de paiement, de retours bancaires, de paiements individuels ni de rapprochement.
- Les rapports mensuels et analytiques sont calculés à partir des cycles et lignes réellement chargés; aucun bulletin individuel n'est produit.
- Les écrans RH actuels appellent directement Supabase. L'API Java on-premise n'a pas de routes RH; son client prend en charge la bascule API/Supabase par `VITE_QERP_API_URL` dans d'autres modules.
- `PayrollSettingsCard` configure un barème pays simple, mais ne couvre pas encore les définitions de paie, profils de gains/retenues, calendrier/périodes, politique de révision, profil bancaire ni gabarits documentaires. Aucun barème légal ou format bancaire ne sera prérempli sans source et validation locales.

## Objectifs

- Offrir le même parcours RH/Paie cloud et on-premise via les migrations jumelées et le client API existant.
- Conserver l'identité, l'emploi, les changements effectifs-datés et les traces sans écraser l'historique nécessaire à une paie déjà calculée.
- Définir gains, retenues, avantages, variables et comptes comme des paramètres versionnés par société/pays; calculer et photographier les règles appliquées.
- Séparer calcul, précontrôle, approbation, comptabilisation, paiement, retour bancaire et rapprochement, avec droits centralisés et séparation des tâches.
- Produire des bulletins individuels, registres, rapports de contrôle et de rapprochement, avec CSV/XLSX/PDF/print filtrés, paginés et adaptés aux rôles.
- Ajouter les mouvements et demandes de temps/absence qui sont approuvés avant d'influencer une paie.
- Tester les règles, la sécurité, les migrations et les parcours sur PostgreSQL sans écrire de données de démonstration dans les bases métier.

## Non-objectifs et garde-fous

- Déduire ou coder en dur des taux fiscaux, cotisations légales, règles de congés ou obligations de conservation d'un pays.
- Prétendre se connecter directement aux banques ou déclarer un format bancaire universel sans spécimen validé par la banque concernée.
- Déclarer V80 réceptionnée sans validation des barèmes par pays et recette des documents sous des rôles distincts.
- Ajouter des données fictives aux sociétés réelles.

## Approches considérées

1. **Grand remplacement en une fois** : réécrire toutes les pages, tables et calculs. Rejeté car risque élevé de rupture et migration difficile à contrôler.
2. **Compléter les pages existantes uniquement sur Supabase** : rejeté car le mode on-premise contournerait la base locale et divergerait de l'objectif de synchronisation.
3. **Tranches verticales à migrations jumelées, API/Supabase unifiées et tests PostgreSQL — approche retenue** : chaque tranche livre un flux complet et vérifiable, réutilise les pages et rôles existants, et n'avance pas les paiements ou congés avant de disposer de données calculées fiables.

## Architecture et contraintes

- Toute évolution de schéma a une migration Flyway et sa jumelle Supabase au SQL exécutable identique; `npm run db:check-twins` doit passer.
- Le front sélectionne l'API Java si `VITE_QERP_API_URL` est configurée et Supabase sinon. Les deux adaptateurs retournent les mêmes types et erreurs et utilisent le tenant actif issu de l'authentification; le client ne peut pas élargir son périmètre.
- Les mutations sensibles et calculs sont validés par SQL/RPC ou API sur le serveur. Les boutons cachés et masques visuels ne remplacent jamais RLS et les droits centralisés.
- `view_sensitive`, coordonnées bancaires, export, saisie, approbation, exécution, audit et administration de paramètre restent des autorisations distinctes; les affectations de population salarié sont respectées par les lectures et les exports.
- Une paie postée est immuable. Les corrections utilisent un cycle d'ajustement/contrepassation audité et ne réécrivent pas les bulletins historiques.
- Les profils de paiement sont versionnés et configurés à partir des exigences de la banque; le fichier produit garde l'identifiant de profil et son empreinte.

## Lots et critères de sortie

1. **Socle API, droits et paramètres** : parité cloud/on-premise pour l'annuaire, cycles, paramètres et audit; refus serveur testé sans droit; champs sensibles non exposés sans droit.
2. **Dossier et mouvements RH** : embauche, changement daté de poste/département/contrat/salaire, suspension, fin de service, correction et réintégration; motif, acteur, approbation et historique consultables.
3. **Composantes et données variables de paie** : catalogue de gains/retenues/charges versionné; affectations salariés; entrées de variable et justification; date d'effet et compte comptable configurés; photographie dans le cycle.
4. **Cycle contrôlé et comptabilisé** : précontrôle avec exceptions, calcul reproductible et recalcul seulement avant approbation, séparation des rôles, posting équilibré et procédure de correction après posting.
5. **Bulletins et rapports** : bulletin individuel exact par cycle/devise, réédition auditée, registres pré/post paie, analyse par période/composante/département/salarié, filtres identiques pour écran et export.
6. **Paiements** : lots créés depuis cycles postés, prévisualisation et contrôle des bénéficiaires/totaux, approbation/émission distinctes, profil de banque versionné, import de retours, rejet/reprise idempotente et rapprochement comptable/bancaire.
7. **Temps, absences et clôture RH** : calendriers et politiques configurables, demandes/approbations/audit, soldes disponibles et transmission des éléments approuvés à une paie; état et rapports de clôture.

## Références

Les pratiques de séquencement, d'historique, de rapports et de séparation des droits sont issues de la recherche officielle consignée dans [le rapport Sage/SAP](../../../reports/Paie%20RH%20Sage%20fonctionnalit%C3%A9s.md). Ces références sont des modèles fonctionnels régionaux; elles ne constituent pas une validation des règles locales d'un pays OHADA.

## Décisions laissées aux prochains lots

- Chaque règle fiscale, sociale, horaire ou de congé doit citer une source officielle, un pays, une date d'effet et un approbateur de société avant activation.
- Les gabarits bancaires et les champs de bulletin restent administrables et versionnés; le responsable métier fournit les spécimens locaux avant activation dans une société.
- La distribution aux salariés et les coordonnées bancaires demandent une politique de sécurité approuvée; jusque-là, le module garde les exports derrière des droits et n'envoie rien par courriel.
