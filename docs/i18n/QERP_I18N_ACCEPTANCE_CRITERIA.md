# QERP — Critères d'acceptation i18n

## 1. Critères du PoC (définis par l'instruction du 26 novembre 2026)

| ID | Critère | Preuve attendue | Où se trouve la preuve |
|---|---|---|---|
| AC01 | 100 % des clés visibles du périmètre pilote en FR et EN, sans clé brute ni mélange involontaire | Inventaire et tests de catalogues | `npm run i18n:check`, `src/i18n/__tests__/catalogs.test.ts`, règle ESLint, `tests/e2e/i18n-langues.spec.ts` (`noRawKeys`) |
| AC02 | Bascule FR / EN sans rechargement ni perte de formulaire | Test composant et Playwright | `language-switch.test.tsx`, `i18n-langues.spec.ts` (marqueur de page) |
| AC03 | Préférence persistée après reconnexion, défaut société et langue inactive correctement résolus | Tests API / DB / E2E | `LanguesEtFormatsIT.preferences`, `.api`, `language-provider.test.tsx`, test de retour arrière |
| AC04 | Même montant XOF et mêmes dates comptables dans les quatre locales ; valeurs métier inchangées | Tests unitaires et assertions DB | `locale-format.test.ts`, empreintes métier du test de retour arrière |
| AC05 | Refus métier traduit avec paramètres, repli sûr si clé absente ou DETAIL invalide | Tests Java / Supabase | `PublicErrorDetailsTest`, `LanguesEtFormatsIT.api`, `errors.test.ts` |
| AC06 | Facture EN émise en test : langue, modèle et octets conservés après bascule FR ; historique intact | Empreintes contexte et PDF avant / après | `LanguesEtFormatsIT.factureEnAnglais`, test de retour arrière, rendu Gotenberg |
| AC07 | Aucune lecture / écriture de préférences ou traductions d'une autre société ; droits vérifiés | Tests négatifs RLS / API à deux sociétés | `LanguesEtFormatsIT`, `IsolationSocietesIT`, `language-provider.test.tsx` |
| AC08 | Tests FR de référence sans nouvelle régression, parcours pilote EN vert | Rapports avant / après | rapport d'exécution §5 |
| AC09 | CI détecte clé / variable manquante et nouveau littéral visible ; budget gzip vérifié | Journaux CI / build, mesures comparables | `i18n:check` (cas négatif), autotest ESLint, mesure d'entrée |
| AC10 | Retour arrière testé sans perte des données métier ni des traductions | Procédure et résultats en environnement isolé | `QERP_I18N_MIGRATION_AND_ROLLBACK.md` §4 |
| AC11 | Interface accessible, responsive et conforme au design, FR / EN | Captures et tests ciblés | captures Playwright 390 / 1440 px, clair / sombre |

Statuts admis : PASS, FAIL, BLOCKED, NOT RUN. Un test non exécuté ne vaut pas PASS. GO seulement si tous les
critères applicables sont PASS, sans régression critique ni faille d'isolation.

## 2. Critères de phase (remplacent ceux de la stratégie de test du matin)

| Phase | Critère mesurable |
|---|---|
| 1 | Fichiers des écrans MVP dans `perimetre-pilote.js`, règle ESLint verte ; 100 % des clés `en` ; **100 % des sites `RAISE` de la liste fermée des refus critiques** avec clé ; parcours FR inchangés et verts ; parcours EN verts nuage **et** sur site ; budget du premier écran conforme à la décision du PO |
| 2 | Modules commercialisés au périmètre ; **≥ 95 % des sites `RAISE` applicables** des fonctions en vigueur, exceptions listées ; pièces commerciales et bulletin en `en` avec formats figés ; LMC société, revue à deux personnes testée |
| 3 | Une troisième langue ajoutée sans modification de code ; pseudo-langue RTL sans régression majeure |
