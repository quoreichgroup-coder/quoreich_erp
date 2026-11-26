# Design system et responsive — listes métier en cartes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** rendre consultables sous forme de cartes sur téléphone les six listes principales des Achats et des Ventes, en conservant leurs comportements existants.

**Architecture:** option `mobileColumns` du composant `Table`. Les mêmes cellules sont présentées en grille sous 768 px et restent un tableau à partir de 768 px. Les métadonnées des colonnes fournissent les libellés des champs et distinguent sélection, référence principale et actions. Les boutons de tri et la sélection globale restent accessibles ; aucune seconde copie des lignes ou de leurs actions n'est montée.

**Tech Stack:** React, TypeScript, Tailwind, composants UI existants, Vitest et Playwright.

**Spec:** continuation autorisée du design system et du responsive ; suite des listes en cartes annoncée à la livraison du premier lot, conformément à UX-9.

## Contraintes

- Respecter `AGENTS.md` et conserver tous les changements précédents du checkout.
- Ne modifier aucune requête, permission, mutation, formule ou portée d'export.
- Utiliser les listes et pages déjà filtrées/triées ; conserver les mêmes identifiants pour la sélection.
- Préserver les instances des actions et des fenêtres lors du redimensionnement.
- Activer ce rendu uniquement sur les six listes explicitement migrées ; préserver les autres tableaux.
- Afficher les valeurs longues sans tronquer les informations utiles dans les cartes et conserver les états vides sans faux libellé de champ.
- Aucun ajout de dépendance ni changement de base de données.

## Tâches

- [x] Écrire les régressions sur données simulées non vides et observer les échecs : disposition en cartes, tris, pagination, sélection, export, droits et redimensionnement.
- [x] Ajouter les métadonnées et le rendu responsive optionnel dans `src/components/ui/table.tsx`, avec une sémantique et des contrôles accessibles.
- [x] Migrer demandes/commandes/réceptions d'achat et devis/commandes/livraisons de vente avec les mêmes données et actions.
- [x] Vérifier les transitions mobile/tablette, les textes longs, les listes vides et les fenêtres ouvertes.
- [x] Exécuter les tests ciblés, les scénarios navigateur du premier et du deuxième lot, la suite Vitest, le typage, le lint et le build.
- [x] Effectuer la revue indépendante du diff de ce lot et actualiser les conventions.

## Review Focus

- Aucune action ni requête dupliquée entre cartes et tableau ; une fenêtre ouverte conserve son état au changement de largeur.
- Les contrôles de sélection ne déclenchent pas l'ouverture d'une pièce ; les exports conservent la liste filtrée et la sélection existantes.
- Tri et pagination restent disponibles à 390 px ; le tableau normal revient à 768 px.
- Les droits désactivés ou absents dans la version actuelle restent identiques dans les cartes.
- Les états vides et cellules fusionnées ne reçoivent pas de légende erronée ; les tableaux non migrés ne changent pas.

## Exécution

Le lot est réalisé dans le checkout courant. Les fichiers avant modification sont sauvegardés sous `output/design-system-lot2/baseline/` pour distinguer ce travail du premier lot et des changements utilisateur antérieurs.
