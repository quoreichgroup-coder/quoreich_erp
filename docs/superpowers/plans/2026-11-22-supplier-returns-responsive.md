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

- [x] Écrire et observer les échecs initiaux des cartes, du focus et de l'export sur données non vides.
- [x] Migrer les huit colonnes vers les primitives `Table`, références accessibles, textes longs et retour de focus explicite.
- [x] Ajouter la branche d'export Retours avec les données du même hook, sans nouvelle lecture ni modification d'accès.
- [x] Vérifier tailles téléphone/tablette/bureau, détails et CSV, lecture seule, états vides et deux thèmes.

## Tâche 2 — Retour et avoir du retour

**Interfaces :** `SupplierReturnDialog` reçoit un `returnFocusRef` optionnel ; son parent conserve le bouton de réception. Les fenêtres locales de détail et d'avoir reçoivent leurs références, avec une cible stable de succès pour l'avoir.

- [x] Observer l'échec initial de la géométrie des champs sur téléphone.
- [x] Appliquer les grilles sur une colonne, contrôles tactiles, région de lignes défilante et case de remplacement lisible ; garder validations et paramètres métier.
- [x] Vérifier saisie au redimensionnement, erreur puis succès, plafond retournable, ligne épuisée, facture approuvée de la même commande et focus après disparition d'une action.
- [x] Exécuter compilation, TypeScript, lint, tests métier/UI ciblés et régressions pertinentes ; revue indépendante ; consigner preuves et conventions.

**Exécution :** continuation dans le checkout existant autorisé, sauvegardes dans `output/design-system-supplier-returns/baseline/`, aucun commit ou déploiement. Configurations temporaires de contrôle avec transformation intégrée de Vite, SWC étant bloqué par les permissions locales. Le périmètre ne requiert pas de nouvelle décision graphique : il suit les composants et la charte validés.

## Reprise et décisions du 26 novembre

- Demandes ajoutées par l'utilisateur : aligner le favicon sur la marque et mettre à jour le README complet. Le README est traité en parallèle dans un fichier séparé, depuis les configurations actuelles du dépôt.
- Favicon : symbole QERP vectoriel allégé, bleu #0062db et orange #ff8a51, déclinaisons ICO 16/32/48/64 et Apple Touch 180 depuis le SVG ; le logo complet existant reste identique.
- Le diagnostic à 320 px identifie une référence non sécable de 70 chiffres débordant dans un enfant flex, le fil d'Ariane débordant de 5 px et les contrôles des lots comptables ne se repliant pas. Corrections ciblées dans `SupplierReturns.tsx`, `Breadcrumb.tsx` et `GLPostingConfig.tsx`, sans masquer globalement le débordement. Les deux fichiers partagés sont sauvegardés avant modification.
- La revue indépendante a identifié une facture/référence conservée en changeant de retour. Le huitième scénario reproduit l'envoi encore possible d'une facture d'une autre commande. Le dialogue est désormais monté à l'ouverture, et une facture encore éligible est requise avant mutation.

## Clôture du 27 novembre

- Retours et favicon : 59 scénarios navigateur réussis sur les neuf suites, puis 18 tests métier/UI ciblés réussis. TypeScript, compilation de contrôle, ESLint et cohérence i18n : sorties 0. ESLint conserve 60 avertissements dans les fichiers contrôlés, sans erreur.
- Revue indépendante du correctif de facture et du delta partagé/favicon : aucun défaut supplémentaire confirmé.
- README réécrit depuis les sources actuelles : modes local/Supabase, configuration, architecture, modules et limites, droits/CFO, documents, i18n, design system, tests, migrations et exploitation. Relecture principale contre manifestes/configurations ; 87 liens locaux, 15 ancres et 21 commandes npm vérifiés.
- Journaux et captures : `output/design-system-supplier-returns/`. Aperçu favicon : `output/branding-favicon/qerp-favicon-sizes.png`. Aucun commit ni déploiement.
