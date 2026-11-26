# QERP — Stratégie de test i18n / l10n

## 1. Principe directeur : ne pas casser les parcours existants

1 293 sélecteurs E2E et 154 sélecteurs Vitest lisent des libellés français. Règle proposée (D-I18N-009) :
**les tests s'exécutent en `fr`**, langue source. Comme les catalogues `fr` reprennent les textes actuels
au mot près, l'extraction ne change aucun libellé et les parcours restent verts sans modification.
Un parcours `en` dédié vérifie l'anglais. Les `data-testid` existants restent la voie préférée pour les nouveaux tests.

## 2. Niveaux

| Niveau | Contenu | Outil |
|---|---|---|
| Unitaire | `locale-format.ts` (fr-BF, fr-FR, en-GB, en-US ; XOF 0 décimale, EUR 2), `montantEnLettres` fr / en, résolution de la matrice de priorité, repli | Vitest |
| Composants | changement de langue à chaud sans perte de saisie (formulaire rempli → bascule → valeurs intactes) | Vitest + Testing Library |
| Base | `i18n_label` (repli), RLS des tables `*_translations`, isolation société (`IsolationSocietesIT` couvre les nouvelles FK automatiquement), gardes des clés réservées, clé `HINT` présente pour les codes convertis | Testcontainers (IT Java) |
| API | `Accept-Language` → langue résolue ; corps d'erreur `{code, key, params, error}` ; langue inconnue → repli sans 500 | IT Java (`ApiSecurityIT` style) |
| Documents | facture émise en `en` : contexte figé contient `language`, réimpression byte-identique après changement de langue utilisateur | IT + parcours 107 étendu |
| E2E | parcours actuels en `fr` (inchangés) + parcours `108-langue-anglaise` : bascule, écrans clés, erreur métier traduite, facture en anglais, export CSV `,` | Playwright nuage + sur site |
| Performance | taille du chunk d'entrée (méthode du Lot 0 : `dist/index.html`) ≤ +10 ko gzip | script de build |
| Sécurité | import de traductions avec HTML / script → refusé ; surcharge d'une clé réservée → refusée ; écriture sans droit → 403 | IT |
| RTL (futur) | capture `dir="rtl"` d'un écran avec une pseudo-langue | Playwright, non bloquant |

## 3. Contrôles CI (job `client-web`)

1. **Clés manquantes** : toute clé utilisée dans le code existe en `fr` (bloquant) et en `en` (bloquant à partir du Go de la phase 1).
2. **Clés inutilisées** : avertissement.
3. **Variables d'interpolation** : mêmes `{{x}}` dans chaque langue que dans la source (bloquant).
4. **Pluriels** : formes requises par la langue présentes (bloquant).
5. **Nouveaux textes en dur** : règle ESLint (`i18next/no-literal-string` ou équivalent) en `error` sur les fichiers
   modifiés, `warn` sur le reste — même méthode que le passage progressif de `no-explicit-any`.
6. **`"fr-FR"` littéral** interdit hors `src/i18n` et `locale-format.ts`.
7. **Pseudo-localisation** (`xx` : textes allongés de 30 % et accentués) pour repérer les débordements.

## 4. Critères d'acceptation mesurables

| Version | Critère |
|---|---|
| Phase 1 | 100 % des écrans du périmètre MVP sans littéral visible (contrôle 5 vert) ; 100 % des clés `en` présentes ; 144 codes QG avec clé ; tous les parcours `fr` verts ; parcours `en` vert nuage + sur site ; chunk d'entrée ≤ +10 ko gzip |
| Phase 2 | 100 % des modules commercialisés ; ≥ 95 % des `RAISE` avec clé ; documents commerciaux et bulletin en `en` ; LMC société avec circuit de revue testé à deux personnes |
| Phase 3 | une 3e langue ajoutée **sans modification de code** (fichiers + données) ; pseudo-langue RTL sans régression visuelle majeure |

## Note de consolidation — 26 novembre 2026, après-midi (C-06) — contrôles réellement en place

- `npm run i18n:check` (job CI `client-web`) : clés FR/EN, variables, pluriels, registre d'erreurs ↔ catalogues,
  aucune locale codée en dur dans les fichiers pilotes, cliquet sur les `"fr-FR"` de `src/` (280), autotest de la
  règle ESLint. Preuve d'échec : retirer une clé et changer une variable → code 1 avec les deux anomalies nommées.
- Budget : mesuré sur **toutes les ressources d'entrée effectivement chargées** (`<script>` et `<link>` de
  `dist/index.html`, gzip niveau 9), pas sur `index.html` seul ; dépassement documenté, seuil inchangé.
- Tests FR existants exécutés avec leurs assertions ; seuls ont été adaptés les contrats réellement élargis
  (argument `_language`, export `useOptionalAuth` d'un mock, compte du catalogue, manifeste du schéma).
