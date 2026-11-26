# Finalisation de la personnalisation des accès

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Supprimer les matrices de rôles fixes qui contredisent la personnalisation et terminer les vérifications TypeScript.

**Architecture:** Remplacer seulement les matrices fixes par AuthorizationsPanel en mode `permissionsOnly` dans les paramètres de rôles Projets, Notes de frais, Immobilisations et CRM. Conserver les affectations, les contrôles de rôles incompatibles, les dialogues, les historiques et les exports propres à chaque module. Adapter les fonctions SMTP/PDF au socle ES2020 sans changer la cible du projet.

**Tech Stack:** React, Vitest, TypeScript ES2020, Vite.

**Spec:** Demande « continuer » après la personnalisation des rôles, avec Administrateur verrouillé ; suite de 2026-11-21-role-permissions.md.

## Contraintes et revue

- Aucun changement des droits enregistrés, des comptes ou des migrations.
- Les utilisateurs non administrateurs restent en consultation ; Administrateur reste verrouillé.
- Les paramètres de rôles affichent les permissions effectives ; leurs parcours d'affectation et journaux historiques restent présents.
- Conserver la cause d'une livraison SMTP incertaine et la détection des clés propres des demandes PDF.
- API métier sur 8092/qerp_reel ; ne pas reconstruire ou redémarrer le serveur pour ces seuls changements frontend.

## Étapes

- [x] Reproduire les vues de rôles obsolètes et les trois erreurs TypeScript.
- [x] Brancher l'éditeur commun dans les quatre vues ; tester la personnalisation et les protections.
- [x] Corriger la compatibilité ES2020 SMTP/PDF avec les tests de non-régression correspondants.
- [x] Contrôle TypeScript complet, tests frontend complets, compilation et revue ciblée.
- [x] Vérifier le frontend local et la santé de l'API, consigner les résultats.

## Résultats ciblés et revue

- Huit tests rouges ont reproduit les matrices fixes ; le test du mode `permissionsOnly` a d'abord échoué sur l'exposition des affectations génériques.
- Vingt tests de l'éditeur et de ses intégrations passent, dont les interdictions Projets Planificateur/Contrôleur, Notes de frais Saisie/Approbateur et CRM Manager/Agent.
- Les tests SMTP/PDF vérifient la cause d'une livraison incertaine, l'absence d'`Object.hasOwn` en ES2020 et les identifiants hérités du prototype.
- Test de téléchargement PDF adapté à FileReader dans jsdom, en conservant l'assertion sur le contenu exact ; attente d'infobulle actualisée pour demander les droits personnalisables.
- Revue indépendante finale : aucun problème important restant dans le périmètre ; affectations, séparation des rôles, historique et exports préservés.
- Lint des fichiers modifiés sans erreur, avertissements `any` préexistants seulement. Compilation locale réussie sur API 8092 ; contrat OpenAPI cohérent et 131 paires de migrations synchronisées.
- Les quatre composants sont servis en HTTP 200 par Vite 8081 avec l'éditeur de permissions intégré ; API 8092 en HTTP 200 / UP, sans redémarrage ni écriture de données.
- Suite frontend complète : **719/719 tests, 125/125 fichiers**, `.tmp-role-follow-up-suite-final.log`.
- Contrôle TypeScript complet : **réussi, code de sortie 0**, `.tmp-role-follow-up-types-verified.log` ; les trois erreurs SMTP/PDF sont résolues sans changer la cible ES2020.
- Compilation finale : `.tmp-role-follow-up-build.log` ; dernière passe lint des nouveaux tests et fonctions partagées sans erreur ni avertissement, et `git diff --check` réussi sur les fichiers suivis modifiés.
