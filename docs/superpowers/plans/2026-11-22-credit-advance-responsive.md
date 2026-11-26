# Avoirs, crédits et avances : charte et responsive

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Appliquer ensemble le design system de la charte et les adaptations mobile aux avoirs et avances clients/fournisseurs.

**Architecture:** Réutiliser `Table.mobileColumns`, `Button`, `DialogContent.returnFocusRef` et le socle de marque existants. Les listes gardent une seule instance des lignes ; les formulaires commencent sur une colonne et gardent les saisies au redimensionnement. Aucun changement des données, droits, calculs ou mutations.

**Tech Stack:** React, Tailwind, shadcn/Radix, Playwright, Vitest.

**Spec:** Demande utilisateur de poursuivre design system et responsive ensemble ; `docs/design-system.md` ; `docs/charte graphique.pdf`.

## Contraintes et points de revue

- Conserver les valeurs, périmètres, droits et actions métier existants ; ne pas ajouter de devise fixe aux légendes mobiles.
- Les avoirs intégrés à une facture omettent les colonnes Facture et Tiers : leurs métadonnées doivent suivre les cellules réellement présentes, sans fragment contenant plusieurs cellules.
- Rendre la référence des avoirs accessible au clavier et restituer explicitement le focus après fermeture, y compris dans le panneau de facture.
- Les noms/motifs longs restent complets sur téléphone ; les montants et références restent lisibles sur ordinateur.
- Les formulaires d'avoir client, d'avoir fournisseur, d'acompte client, d'avance fournisseur et de remboursement restent utilisables à 320 px. La grille d'édition des lignes d'avoir client conserve une largeur utile et un défilement local.
- Les thèmes et la marque restent ceux du socle déjà validé ; pas de nouvelle palette ou de composant de substitution.

## Tâche 1 — Les quatre registres et leurs détails

**Fichiers :** `src/components/ARCreditNotes.tsx`, `ARCustomerCredits.tsx`, `SupplierReturns.tsx`, `SupplierAdvances.tsx` ; `tests/e2e/credits-advances-responsive.spec.ts`.

- [x] Écrire puis observer échouer les scénarios sur les listes non vides à 320/390/767/768/1440 px, avec textes longs et avoirs intégrés.
- [x] Migrer les quatre registres aux primitives `Table` et aux métadonnées mobiles alignées ; rendre les références d'avoir accessibles avec retour de focus.
- [x] Vérifier les mêmes lignes/montants après redimensionnement, les détails au clavier, les états vides et les restrictions de remboursement/création.

## Tâche 2 — Formulaires et transitions

**Fichiers :** les quatre composants ci-dessus ; `src/pages/ARTransactions.tsx`, `APTransactions.tsx` pour leurs références de boutons ; même suite navigateur.

- [x] Écrire puis observer échouer les scénarios de géométrie tactile et de focus des cinq formulaires ; saisir des valeurs et redimensionner.
- [x] Appliquer les grilles à une colonne mobile, les contrôles de 44 px avec texte de 16 px et les retours de focus explicites. Garder les appels métier identiques.
- [x] Vérifier les erreurs conservant la saisie et un appel de remboursement simulé avec le même montant et le même crédit.
- [x] Exécuter les contrôles TypeScript, lint, compilation et tests ciblés ; revue indépendante du lot ; consigner les résultats et conventions.

**Exécution :** continuation dans le checkout actuel déjà autorisé, avec sauvegardes ciblées dans `output/design-system-credits-advances/baseline/`. Pas de commit ni de déploiement automatique. Les configurations temporaires de contrôle reprennent la transformation intégrée de Vite, SWC étant bloqué par les permissions locales.

## Décisions et revue

- Le bandeau du logo a été ajusté à la demande de l'utilisateur pendant ce lot : fond blanc bord à bord, logo centré en couleurs et sans déformation, arrondi inférieur gauche de 12 px, côté droit droit. L'utilisateur a validé ce rendu et demandé la reprise du lot.
- Extension justifiée à `DocumentDetail.tsx` : une capture d'avoir client montre les dernières colonnes coupées par `overflow-hidden` et l'identité comprimée dans 115 px sur téléphone. Le test renforcé reproduit ce problème. Corriger ce composant partagé (en-tête une colonne, actions repliables, grille large à défilement local, pied lisible), avec régression élargie aux consommateurs existants.
- La revue indépendante a relevé le retour de focus manquant après clic sur une valeur de ligne hors référence. Le neuvième scénario a reproduit l'échec, puis vérifié le correctif pour clients/fournisseurs et registre/vue intégrée : la fermeture revient à la référence de la même ligne. La revue reprise après cette correction ne relève aucun blocage supplémentaire ; les droits, calculs et exports restent ceux du module.
- Dernier cas contrôlé : un remboursement total retire sa ligne après actualisation des données. Le dixième scénario a reproduit le focus perdu ; le correctif revient au titre stable de la liste. Après cet ajustement local, les dix scénarios du lot et les quatorze tests ciblés Dialogue/Table/Navigation ont été repassés. Les contrôles globaux précédents (49 scénarios navigateur et 729 tests unitaires) sont conservés comme preuve de régression ; ils précèdent ce dernier ajout de focus.

## Bilan final

Lot livré localement : quatre registres, cinq formulaires, détails partagés et bandeau de logo validé. TypeScript final, compilation finale, ESLint et `git diff --check` : sorties 0. Les journaux et captures se trouvent dans `output/design-system-credits-advances/`. Aucun commit ou déploiement ; la migration des autres écrans reste à poursuivre par module.
