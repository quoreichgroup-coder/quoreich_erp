# Retours fournisseurs — design system et responsive

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Adapter le registre, le détail et les deux formulaires de retours fournisseurs avec les composants et la charte déjà validés.

**Architecture:** `Table.mobileColumns` pour le registre, `Button` pour ses références et actions, `DialogContent.returnFocusRef` pour les fenêtres contrôlées. Grille de quantités à défilement local ; champs sur une colonne et cibles tactiles sur téléphone. Le bandeau du logo validé reste celui du socle.

**Tech Stack:** React, Tailwind, shadcn/Radix, Playwright, Vitest.

**Spec:** Demande utilisateur de poursuivre design system et responsive ensemble ; `docs/design-system.md` ; `docs/charte graphique.pdf`.

## Contraintes et points de revue

- Préserver les données, droits, calculs de retour/TVA et appels métier existants.
- Les mêmes lignes et montants apparaissent en cartes sous 768 px et en tableau au-delà. Noms et motifs complets sur téléphone ; montants et références lisibles sur ordinateur.
- Rendre le focus au bouton de la réception après création/annulation d'un retour ; au bouton de référence après fermeture d'un détail ouvert au clavier ou par la ligne.
- Après comptabilisation de l'avoir, son bouton disparaît : rendre le focus à la référence stable du retour concerné. Après annulation/erreur, garder le déclencheur ou la saisie.
- Les quantités déjà retournées, les lignes épuisées, le remplacement et le choix de facture doivent conserver leur comportement.
- Correction ciblée de l'export d'en-tête : l'onglet Retours tombe actuellement dans l'export des demandes d'achat. Exporter les mêmes retours que le registre ; conserver les autres branches.

## Tâche 1 — Registre, détail et export

**Fichiers :** `src/components/SupplierReturns.tsx`, `src/pages/ProcurementTransactions.tsx`, `tests/e2e/supplier-returns-responsive.spec.ts`.

- [ ] Écrire et observer les échecs initiaux des cartes, du focus et de l'export sur données non vides.
- [ ] Migrer les huit colonnes vers les primitives `Table`, références accessibles, textes longs et retour de focus explicite.
- [ ] Ajouter la branche d'export Retours avec les données du même hook, sans nouvelle lecture ni modification d'accès.
- [ ] Vérifier tailles téléphone/tablette/bureau, détails et CSV, lecture seule, états vides et deux thèmes.

## Tâche 2 — Retour et avoir du retour

**Interfaces :** `SupplierReturnDialog` reçoit un `returnFocusRef` optionnel ; son parent conserve le bouton de réception. Les fenêtres locales de détail et d'avoir reçoivent leurs références, avec une cible stable de succès pour l'avoir.

- [ ] Observer l'échec initial de la géométrie des champs sur téléphone.
- [ ] Appliquer les grilles sur une colonne, contrôles tactiles, région de lignes défilante et case de remplacement lisible ; garder validations et paramètres métier.
- [ ] Vérifier saisie au redimensionnement, erreur puis succès, plafond retournable, ligne épuisée, facture approuvée de la même commande et focus après disparition d'une action.
- [ ] Exécuter compilation, TypeScript, lint, tests métier/UI ciblés et régressions pertinentes ; revue indépendante ; consigner preuves et conventions.

**Exécution :** continuation dans le checkout existant autorisé, sauvegardes dans `output/design-system-supplier-returns/baseline/`, aucun commit ou déploiement. Configurations temporaires de contrôle avec transformation intégrée de Vite, SWC étant bloqué par les permissions locales. Le périmètre ne requiert pas de nouvelle décision graphique : il suit les composants et la charte validés.
