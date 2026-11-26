# Design system et responsive — premier lot

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** appliquer le socle visuel QERP et corriger les débordements reproduits dans les écrans Achats, Ventes, Paramètres et les composants partagés.

**Architecture:** conserver React, Tailwind et les primitives Radix existantes. Centraliser les règles de présentation dans les composants UI et un en-tête de page partagé, puis migrer les premières pages sans changer leurs requêtes, leurs droits ou leurs actions métier.

**Tech Stack:** React 19, TypeScript, Tailwind 4, shadcn/Radix, Vitest, Playwright.

**Spec:** audits responsive/design system et vérification de la charte dans la conversation ; instruction du propriétaire : commencer l'application. Le logo du produit est QERP, distinct du logo QUOREICH GROUP.

## Global Constraints

- Respecter `AGENTS.md`, notamment les scopes et exports CFO ainsi que la restitution du focus des dialogues contrôlés.
- Conserver les changements déjà présents dans le checkout ; aucune modification de migration, de requête ou de règle métier.
- Reprendre exactement les couleurs #0062db et #ff8a51. Conserver Montserrat dans l'interface ; Playfair reste disponible pour l'éditorial.
- Utiliser le logo QERP généré dans cette conversation. Ne pas remplacer l'identité légale des sociétés ni leurs documents par celle de l'application.
- Aucun ajout de dépendance. Aucune publication, aucun commit regroupant le travail existant.
- Mesurer la géométrie réelle dans le navigateur : ne pas masquer les problèmes par un `overflow-x:hidden` global.

## Review Focus

- À 360/390 px et à 768/1024 px avec barre latérale, actions et onglets restent accessibles sans défilement horizontal du contenu principal.
- Une demande de six lignes tient dans la hauteur disponible ; ses champs et boutons restent accessibles par défilement local et au clavier.
- Le panneau de notifications reste dans le viewport, y compris avec zoom et petit écran.
- Tri clavier, pagination et exports gardent leur comportement et leurs libellés accessibles.
- Les modales CFO conservent leur focus, leur fermeture Échap et leur périmètre de données.

## Task 1 — Régressions observables

- [x] Ajouter les scénarios navigateur reproduisant les débordements Achats/Ventes, les six lignes et les notifications à 360 px ; observer leurs échecs avant correction.
- [x] Ajouter des tests du tri au clavier et des contrôles de pagination nommés ; exécuter le socle existant ciblé.

## Task 2 — Fondation visuelle et composants partagés

- [x] Corriger la précision des couleurs et ajouter les jetons warning/info ; documenter les conventions de densité et de hiérarchie.
- [x] Ajouter `AppLogo` et copier le PNG du logo produit sous `public/branding/` ; l'utiliser à la connexion et dans la barre latérale.
- [x] Ajouter `PageHeader` pour le titre, la description et les actions adaptatives.
- [x] Contenir les onglets dans leur propre zone de défilement, avec conservation de la navigation Radix au clavier.
- [x] Borner et faire défiler les fenêtres et confirmations ; conserver les props et gestionnaires de focus existants.
- [x] Adapter filtres, pagination, panneau de notifications et grille de lignes ; rendre le tri accessible au clavier.
- [x] Conserver les correspondances de statut et remplacer les couleurs warning codées en dur par les jetons.

## Task 3 — Première application aux pages

- [x] Migrer les en-têtes Achats, Ventes et cockpit vers `PageHeader` et les boutons du design system.
- [x] Adapter les grilles de champs trop denses des premières pièces et rendre la sélection des rubriques de Paramètres compacte sous 1024 px.
- [x] Aligner le shell du tableau de bord et rendre la réduction du menu disponible à toutes les largeurs.

## Task 4 — Vérification et livraison du lot

- [x] Exécuter les tests ciblés puis la suite Vitest ; signaler séparément toute défaillance préalable ou environnementale.
- [x] Exécuter typage, lint des fichiers touchés et build.
- [x] Vérifier les cinq tailles d'écran et capturer les écrans représentatifs après modification.
- [x] Faire relire uniquement le diff de ce lot, corriger les régressions importantes et documenter ce qui reste pour les autres modules/listes en cartes.

## Décisions d'exécution

- Travail dans le checkout actuel, sur `codex/finaliser-module-rh-paie` : il contient les évolutions utilisateur nécessaires aux écrans audités. Un nouveau checkout propre perdrait ce contexte ; aucune opération Git destructive n'est prévue.
- L'instruction « commence » autorise l'exécution de l'approche progressive déjà présentée ; aucune nouvelle boucle d'approbation n'est nécessaire.
- La conversion de toutes les listes ERP en cartes et la migration des pièces vers des pages dédiées sont des lots suivants. Le présent lot stabilise les composants et les écrans sur lesquels les défauts ont été reproduits.

## Vérification et revue du lot livré

- Socle avant modification : 21 tests ciblés réussis. Les nouveaux tests de tri/pagination échouaient avant correction ; les cinq premiers scénarios responsive reproduisaient les défauts mesurés.
- Revue indépendante, limitée aux écarts avec la sauvegarde du checkout : cinq problèmes identifiés et corrigés. Les régressions de hauteur des onglets, dimensions des boutons, focus sans focus préalable du déclencheur, navigation hors écran du menu réduit et colonnes implicites des formulaires ont été vérifiées avant correction.
- La restitution du focus repose désormais sur `returnFocusRef` explicite pour les créations PR/PO/GR. Le comportement natif des `DialogTrigger` et les gestionnaires spécifiques CFO restent prioritaires.
- Suite Vitest finale : **127 fichiers, 722 tests réussis**. Scénarios Playwright : **9/9 réussis**.
- Typage TypeScript : réussi. Lint des 27 fichiers TypeScript touchés : **0 erreur**, 74 avertissements. Build de production : réussi.
- Contrôle visuel sur cinq écrans et cinq largeurs : **25 mesures, aucun débordement du contenu principal, aucune erreur JavaScript**. À 390 px, Achats passe de 1 578 à 390 px de contenu ; Ventes de 779 à 390 px. La demande de six lignes est contenue dans 812 px de haut, avec défilement intérieur, pour un viewport de 844 px.
- Les résultats et captures sont conservés sous `output/design-system-lot1/` et `output/playwright/`. Les mesures du navigateur utilisent des données de test simulées ; aucune écriture métier n'est effectuée.
- Une interruption du service d'approbation avait empêché un premier lancement de la suite complète. Après reprise, la commande a été autorisée et toutes les vérifications ci-dessus ont pu être exécutées.

Les travaux suivants restent décrits dans `docs/design-system.md` : listes en cartes, pages dédiées aux pièces complexes et adoption progressive des conventions dans les autres modules.
