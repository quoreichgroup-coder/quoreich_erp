# 07 — Audit Design System et UX

> Phase 4. Lecture du code et des documents de conception ; aucun test utilisateur réalisé (à organiser).

## 1. Design system

| Point | Constat | Preuve |
|---|---|---|
| Fondation | shadcn/ui + Tailwind 4, jetons sémantiques HSL (`--primary` #0062db, `--brand-accent` #ff8a51), Montserrat / Playfair Display | `src/index.css`, `docs/design-system.md`, `docs/charte graphique.pdf` |
| Respect des jetons | Aucune couleur hexadécimale ni `text-white` en dur ; **190 classes de palette Tailwind directes** restent (`amber-` 138, `blue-` 22, `red-` 18, `green-` 9, `rose-` 3) | EV-22 |
| Composants métier partagés | `PageShell`, fil d'Ariane, bandeau d'aide, `DocumentDetail` (en-tête / lignes / pied), `CommercialLinesEditor`, `StatusBadge`, barres d'actions groupées, exports uniformes | `src/components/` |
| Standard de module | Même menu dans les 15 modules (Tableau de bord, Transactions, Données de base, Rapports, Contrôle, Paramètres), contrôlé par test | `navigation.test.ts` |

## 2. Expérience utilisateur

| Point | Constat |
|---|---|
| Cohérence | Forte : six pages par module, pièces en onglets dans « Transactions », pièces en trois zones |
| Sincérité des données | Plus aucun tableau de démonstration ni bouton inactif (balayage 27, V119) |
| Langue | Interface entièrement en français ; aucun mécanisme de traduction |
| Accessibilité | 535 attributs `aria-*`, libellés associés aux champs (exigés par les parcours), un seul test d'accessibilité dédié (`KpiDrilldownDialog.a11y.test.tsx`) ; **aucun audit WCAG** ni test automatique (axe) |
| Responsive | 819 classes adaptatives ; plans responsive du 21–22 nov. (finance, stocks, crédits, retours) ; saisie de pièces pensée pour le poste de travail (UX-9 : cartes sous 768 px pour la consultation, P3) |
| Retours d'erreur | Messages métier de la base remontés en français (422 avec le texte du refus) ; refus attendus distingués des incidents dans les parcours |

## 3. Écarts

| # | Écart | Priorité |
|---|---|---|
| U-1 | 190 classes de palette directes → jetons sémantiques (`warning`, `info`, `destructive`, `success`) | P2 |
| U-2 | Pas d'audit d'accessibilité (WCAG 2.2 AA) ni de test `axe` dans la CI | P2 |
| U-3 | **Aucun test avec de vrais utilisateurs** (comptable, acheteur, gestionnaire de paie) ; la cohérence est réelle, l'efficacité n'est pas mesurée | P1 avant commercialisation |
| U-4 | Pas d'internationalisation (FR seul) | P2 (P1 si cible hors francophonie) |
| U-5 | Écran `workflow_rules` sans effet (voir 03, F-11) : retirer ou relier à un moteur | P1 |
| U-6 | Pas d'aide contextuelle ni de documentation utilisateur publiée (`/docs` existe, contenu à vérifier) ; pas de visite guidée à la première connexion | P2 |
| U-7 | UX-10 (budget, conformité, risques) à confirmer à l'écran avec le propriétaire | P3 |

## 4. Smart Notes
Aucune trace dans le code ni dans la documentation du dépôt : **NOT STARTED**, spécification non fournie.
