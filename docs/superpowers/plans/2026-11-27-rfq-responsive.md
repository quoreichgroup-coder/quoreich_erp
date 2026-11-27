# Demandes de prix — design system et responsive

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Adapter le registre, les détails et les actions des demandes de prix à la charte et aux petits écrans, en conservant les règles d'achat.

**Architecture:** Réutiliser `Table.mobileColumns`, `Button`, `StatusBadge`, `DialogContent.returnFocusRef` et les jetons existants. Garder un détail en ligne avec une référence accessible ; réinitialiser ses brouillons quand la demande change, les conserver au redimensionnement. Une exportation locale réutilise la liste chargée du panneau ; le bouton global inadapté est masqué pour cet onglet.

**Tech Stack:** React, Tailwind, shadcn/Radix, TanStack Query, Playwright et Vitest.

**Spec:** Demande de poursuivre design system et responsive ensemble ; `docs/design-system.md` ; charte graphique déposée et identité validée.

## Contraintes et revue

- Fichiers métier : `src/components/Rfqs.tsx` et branche d'affichage de l'export dans `src/pages/ProcurementTransactions.tsx`. Aucun changement de RPC, calcul, droit, clé de cache ou conversion monétaire.
- Quatre listes à adapter : registre, lignes demandées, fournisseurs consultés, comparatif. Une seule instance des cellules et contrôles, labels et valeurs alignés, textes longs complets en cartes.
- Création et saisie d'offre sur une colonne mobile, contrôles tactiles et grille de prix à défilement local. Les cases/radios gardent une cible d'au moins 44 px.
- Propositions au moins-disant, offres expirées désactivées, motif hors moins-disant et paramètres des mutations inchangés.
- Annulation via un dialogue avec motif obligatoire à la place de `window.prompt`. Erreur : saisie conservée ; succès : focus au titre stable du détail puisque le bouton disparaît.
- Création/offre : focus à leur initiateur après fermeture. Attendre les lignes avant d'autoriser la saisie d'une offre ; tolérer une ligne arrivée lors d'une actualisation sans déréférencement absent.
- Lecture seule, chargement, erreur explicite avec récupération et états vides restent compréhensibles.
- Le socle graphique, le favicon, le bandeau validé et les autres fichiers utilisateur restent identiques. Les composants Field/Empty ne sont pas présents : conserver les primitives/formulaires du projet, sans installation ni changement de bibliothèque.

## Tâche 1 — Listes et export

- [x] Écrire puis observer les échecs de responsive, référence clavier et export sur données non vides.
- [x] Migrer les quatre listes avec leurs métadonnées, références contrôlant le détail et états chargement/erreur/vides.
- [x] Fournir l'export du registre depuis le même résultat de requête dans le panneau ; adapter le bouton global seulement pour l'onglet RFQ.
- [x] Vérifier mêmes lignes/valeurs de 320 à 1440 px, choix/radios au redimensionnement et scopes d'export/droits.

## Tâche 2 — Formulaires et actions

- [x] Observer les échecs initiaux de géométrie des formulaires et d'annulation native.
- [x] Adapter création et offre, ajouter le dialogue d'annulation et leurs retours de focus, sans changer les contrats de mutation.
- [x] Vérifier erreurs/succès, attribution motivée, offres expirées, réinitialisation en changeant de demande et chargement retardé des lignes.
- [x] Exécuter compilation, lint, TypeScript, tests métier/UI et régressions appropriées ; revue indépendante ; mettre les conventions et preuves à jour.

**Exécution :** continuation autorisée dans le checkout actuel `i18n/poc-langues`, avec sauvegardes ciblées dans `output/design-system-rfq/baseline/`. Pas de commit ni déploiement. Configurations temporaires de vérification avec transformation intégrée de Vite, le binaire SWC étant bloqué par les permissions locales.
