# QERP — Rapport d'exécution du PoC i18n

26 novembre 2026. Instruction : « Consolidation i18n / l10n et lancement du Proof of Concept ». Environnement
local et jetable uniquement ; aucun déploiement, aucune donnée réelle, aucun envoi d'e-mail.

## 1. État initial (POC-00)

| Élément | Valeur |
|---|---|
| Branche de départ | `codex/finaliser-module-rh-paie`, HEAD `7392c6c` (l'audit du matin portait sur V145 ; le dépôt est à **V154**) |
| Branche du PoC | `i18n/poc-langues` (créée depuis `7392c6c`, arbre propre). Une autre session y a ajouté par erreur le commit `3e0a777` (documents `docs/audit/global-product-audit/` seulement, déjà conservé sur sa propre branche) et a modifié `docs/audit/global-product-audit/20_DECISION_REGISTER.md` : laissés intacts, hors PoC |
| Typage | `tsc` app et node : 0 erreur |
| Lint | 0 erreur, 1 570 avertissements |
| Vitest | 133 fichiers, 741 tests, tous verts |
| Premier écran (build) | 11 ressources, 932,9 Ko brut, **256,3 Ko gzip** |

## 2. Décisions et corrections appliquées

D-I18N-001 à 010 : toutes **Validées** (registre mis à jour, propositions du PoC séparées : P-I18N-01 à 04).
Corrections C-01 à C-07 : notes datées ajoutées aux neuf documents du matin, sans réécrire les constats.
Correction majeure de mesure : **38 codes QG** (et non 144), **1 204 messages littéraux distincts**, **2 248 sites
`RAISE`** (voir la note de l'audit).

## 3. Ce qui a été construit

### Base (V155 + jumelle Supabase)
Référentiels `languages` (une seule source, protégée) et `supported_locales` ; `tenants.default_language /
default_locale / timezone` (fuseau contrôlé) ; `tenant_languages` ; `profiles.language / locale` (garde de langue
autorisée) ; `customers.document_language` ; droit `languages.settings` ; `my_language_context`,
`set_my_language_preferences`, `set_company_language_settings` ; langue des modèles et des éditions, langue figée
dans le contexte haché ; gabarit HTML anglais ; refus QG001 de l'émission de facture et du compte manquant portés
par une clé ; nouveaux refus QG038 / QG039 porteurs de clé.

### API Java
`PublicErrorDetails` (clé et paramètres lus dans les champs structurés du pilote, filtrés par le registre
`i18n/error-keys.json`), branché dans `DatabaseRefusalAdvice` et le gestionnaire AR du lot 2 ;
`LanguageController` (`GET/PUT /api/v1/me/language`, `PUT /api/v1/languages/settings`) ; langue transmise à
l'émission et au modèle ; langue PDF/A du moteur de rendu = langue de l'édition ; contrat OpenAPI régénéré.

### Fonction Edge `document-render`
Langue acceptée et validée, transmise à la base ; clé d'erreur relayée ; langue PDF/A de l'édition.

### Front
i18next / react-i18next, 7 namespaces FR / EN (387 clés source, dont 135 entrées de menu générées) ; sélecteur
avant connexion (sans requête) et sélecteur connecté (préférence enregistrée) ; onglet « Langues et formats » ;
`locale-format.ts` + `useLocaleFormat` ; adaptateur d'erreurs commun ; avertissement des écrans non traduits ;
coquille, connexion, accueil Ventes, éditeur de lignes et éditions de facture traduits.

### Contrôles
`npm run i18n:check` (ajouté au job CI `client-web`), règle ESLint `i18next/no-literal-string` en erreur sur les
14 fichiers pilotes, cliquet des `"fr-FR"` codés en dur (280).

## 4. Migrations

| Migration | Fichier Flyway | Jumelle Supabase | Appliquée |
|---|---|---|---|
| V155 langues et formats | `V155__langues_et_formats.sql` | `20261126110000_a8071509-…sql` | bases jetables et Testcontainers uniquement ; **ni cloud, ni `qerp_reel`** |

## 5. Commandes et résultats

| Commande | Avant | Après |
|---|---|---|
| `npx tsc --noEmit -p tsconfig.app.json` / `tsconfig.node.json` | 0 / 0 | 0 / 0 |
| `npm run lint` | 0 erreur, 1 570 avert. | 0 erreur, 1 571 avert. (+1 : un `eslint-disable` de dépendances de `useMemo` dans `Sales.tsx`) |
| `npx vitest run` | 133 fichiers / 741 tests | **138 fichiers / 767 tests, tous verts** (+5 fichiers, +26 tests ; aucun échec, aucune erreur non gérée) |
| `npm run i18n:check` | — | vert ; cas négatif (clé retirée + variable changée) : code 1, deux anomalies nommées |
| `npm run db:check-twins` | 138 paires | **139 paires** synchronisées |
| `npm run api:check` | conforme | conforme après régénération |
| `./mvnw verify` ciblé (14 IT + tous les tests unitaires) | — | vert : `LanguesEtFormatsIT` 3/3, `DocumentsArchivesIT`, `SchemaMigrationIT` 7/7, `AuthorizationsApiIT` 6/6, `IsolationSocietesIT`, `ModuleAccessIT`, `OpenApiContractIT`, `ArInvoiceIT`, `ApiSecurityIT`, `ArParityIT`, `RolesDesModulesIT`, `RolePermissionsIT`, `SocieteDuProfilIT`, `TenantIsolationIT`, `PublicErrorDetailsTest` 5/5 |
| `./mvnw verify` complet | 106 tests au 13/11 (référence CLAUDE.md) | voir §5 bis |
| `npx playwright test tests/e2e/i18n-langues.spec.ts` | — | **2/2 verts** |
| `npm run test:e2e` (suite bouchonnée existante) | 23 réussis, 17 ignorés au 13/11 | voir §5 bis |
| Premier écran (build) | 256,3 Ko gzip | **277,4 Ko gzip (+21,1)** |

Tests existants adaptés, et pourquoi (aucune assertion affaiblie) : `DocumentEditionsControllerTest` et
`document-render-worker.test.ts` (argument `_language` ajouté au contrat ; cas anglais ajoutés) ;
`TopNav.test.tsx` (mock de session complété de `useOptionalAuth`) ; `AuthorizationsApiIT` (154 droits) ;
`SchemaMigrationIT` (objets V155 déclarés, dernière migration 155).

## 5 bis. Suites longues

**Suite Playwright bouchonnée (`npm run test:e2e`), spec du PoC comprise.**
- Premier passage : nombreux écrans **blancs**. Cause trouvée : le backend simulé renvoie `null` pour toute RPC
  inconnue, donc pour `my_language_context` ; le sélecteur de la barre du haut lisait `allowed_languages.filter`
  sur une valeur absente et toute l'application plantait. **Vrai défaut du PoC**, corrigé :
  `normalizeLanguageContext` transforme une réponse nulle, vide ou incomplète en erreur de requête (l'interface
  reste dans la langue courante) ; test de non-régression ajouté (`language-provider.test.tsx`).
- Second passage : **84 réussis, 17 ignorés (specs connectées), 6 échecs**, tous dans
  `supplier-returns-responsive.spec.ts` (débordements horizontaux à 320 px dans Approvisionnement : fil
  d'Ariane, numéros de 70 caractères, badge « 0 batches »). Rejouée sur le code d'origine `7392c6c` dans un
  worktree séparé : **les mêmes 6 échouent** → défaut antérieur au PoC, sans lien avec l'i18n.

**Vitest après correctif** : 138 fichiers, 768 tests ; un dépassement de délai isolé
(`Login.appearance.test.tsx`, 5,2 s pour 5 s) pendant la suite complète, sous charge Docker ; le fichier
rejoué seul passe 3 fois sur 3. Lint 0 erreur, `i18n:check` vert.

**Parcours sur site (`npm run test:e2e:sur-site`)**, contre l'API Java locale reconstruite avec le PoC (base de dev
passée de V147 à V155), comptes de test repris du nuage, front **construit** (`vite build` + `preview`) :
**34 réussis, 12 échecs, 8 non lancés** (dépendants d'un échec). Aucun échec n'est lié au PoC :

| Parcours | Cause | Antérieur au PoC ? |
|---|---|---|
| 30-fournisseurs ×3, 40-clients, 97-jeux-de-comptes, sur-site 10-clients | le test cherche un bouton « Fermer » ; le panneau de facture (qui s'affiche, éditions comprises) a « Fermer la fenêtre » | oui : libellé présent dans `7392c6c` |
| 94-budget-rapports | `getByLabel('Rechercher')` trouve aussi le bouton « Rechercher une page » | oui : libellé présent dans `7392c6c` |
| 81-tresorerie-lecture | l'approbateur sans droit de trésorerie reçoit la page « Accès refusé » (garde V146-V147), sans en-tête | oui |
| 20-achats (commande directe), 96-impressions | données attendues absentes de la base locale neuve (numéros `FA-` / `BROUILLON-`, préalables) | sans lien avec l'i18n |
| sur-site 30-achats | la cellule mobile contient « Statut » avant la valeur | oui (mise en page responsive) |
| sur-site 107-editions | « Le moteur de rendu PDF n'est pas configuré » : l'API de dev n'est pas reliée à Gotenberg | environnement |

Deux faits établis au passage : (1) un premier passage sur le serveur Vite de **développement** échoue partout sur
l'avertissement React « Encountered a script tag » émis par `next-themes` — le même avertissement est produit par
le code d'origine `7392c6c` (comparaison console côte à côte), d'où l'usage d'un front construit ; (2) les six
parcours de connexion cherchaient un texte indicatif `••••••••` retiré de la page avant le PoC (commit `3e6fd27`) :
sélecteurs corrigés sur l'étiquette « Mot de passe » (`tests/e2e/sur-site/00-01`, `parcours/00-01-81`,
`fixtures/treasury-readonly.ts`). Les parcours tournent en français : ils montrent l'absence de régression
française sur site. Le parcours anglais connecté est `tests/e2e/sur-site/108-langues-sur-site.spec.ts` : **vert**
(bascule depuis la barre du haut, `PUT /api/v1/me/language` → 200, langue relue après rechargement complet,
onglet « Langues et formats » en anglais, écran non traduit annoncé, retour au français ; aucun incident).

**Réparation des parcours restés en retard sur l'interface (tests seulement, aucun code applicatif).**
Sélecteurs corrigés : bouton de fermeture « Fermer » ou « Fermer la fenêtre » (30-fournisseurs ×3, 40-clients,
97-jeux-de-comptes, sur-site 10-clients), champ « Rechercher » exact (94), étiquette mobile « Statut » /
« Lettrage » admise dans la cellule (20-achats ×5, 40-clients, sur-site 30-achats), numéros `INV-` en plus de `FA-`
(96). API de dev reliée au moteur PDF par un fichier temporaire hors dépôt, **sans changer de base** (le fichier
`infra/pdf/compose.api.yml` bascule sur `qerp_reel` et n'a pas été utilisé). Rejoués sur site : **20, 30 ×4, 40,
94, 96, 97, sur-site 10, sur-site 30, 107, 108, 109 : tous verts**. Seul reste en échec **81-tresorerie-lecture** :
l'approbateur sans aucun droit de trésorerie reçoit la page « Accès refusé » (garde d'accès aux modules V146-V147),
alors que le parcours attend la page avec montants masqués — **question produit** (quel droit minimal ouvre la
page en lecture masquée ?), non tranchée ici.

**Suite Java complète (`./mvnw verify`)** : **PASS en CI** (GitHub Actions, run `45879254777`, commit `0938fac`,
PR #12 en brouillon) : 40 tests unitaires et 302 tests d'intégration, 0 échec, 0 erreur. Les jobs « Client web »,
« E2E simulés » et « Image de l'API » sont verts aussi. Sur le poste, deux lancements avaient été arrêtés faute
de mémoire.

## 6. Critères d'acceptation

| ID | Statut | Preuve | Réserve |
|---|---|---|---|
| AC01 | **PASS** | `i18n:check` vert (387 clés, FR = EN), `catalogs.test.ts`, règle ESLint 0 erreur sur 14 fichiers, `noRawKeys` dans le parcours EN | Composant partagé (éditeur de lignes) en anglais dans des écrans encore français, sous avertissement explicite |
| AC02 | **PASS** | `language-switch.test.tsx` (saisie gardée, aucun `Suspense`, `lang` / `dir`), Playwright : marqueur de page conservé après FR → EN → FR, à la connexion et connecté | — |
| AC03 | **PASS** | parcours sur site `108-langues-sur-site` (préférence enregistrée par l'API, relue après rechargement complet), `LanguesEtFormatsIT.preferences` (préférence en base, repli si langue retirée sans réécriture, garde sur tous les chemins), `.api`, `language-provider.test.tsx` (cache par utilisateur, retour à la langue du navigateur à la déconnexion), retour arrière | — (reconnexion réelle validée sur site : parcours `108-langues-sur-site`) |
| AC04 | **PASS** | `locale-format.test.ts` (même XOF dans 4 locales, dates identiques sous 4 fuseaux, décimales ISO) ; empreinte métier identique avant / après V155 | — |
| AC05 | **PASS** (Java, base, adaptateur) | `PublicErrorDetailsTest` 5/5, `LanguesEtFormatsIT.api` (422 `{code, key, params, error}` sur le vrai refus QG001 et sur QG039), `errors.test.ts` (Supabase, API, ancien HINT, clé inconnue, DETAIL illisible) | Chemin Supabase réel : NOT RUN (V155 non déployée) |
| AC06 | **PASS** | Chaîne complète sur site, `109-edition-anglaise` : modèle anglais publié par l'API, édition anglaise rendue par Gotenberg et archivée (`en` / `en-GB`, version du modèle figée), empreinte du PDF vérifiée, retour de l'utilisateur au français → réimpression **octet pour octet identique**, édition précédente intacte ; `LanguesEtFormatsIT.factureEnAnglais` (refus sans modèle anglais) ; test de retour arrière | Montants et dates non formatés dans la pièce (comme V141) ; balise `/Lang` non retrouvée dans le PDF |
| AC07 | **PASS** | `LanguesEtFormatsIT` (deux sociétés : RLS, droits, aucune modification croisée, 403 API), `IsolationSocietesIT` vert, clés de cache par utilisateur × société | — |
| AC08 | **PASS** (sur site) | Vitest vert, Java ciblé vert, parcours pilote EN 2/2 (bouchonné), suite Playwright bouchonnée sans régression, parcours **sur site en français : 34 réussis, 12 échecs tous antérieurs ou d'environnement** (§5 bis) | Parcours anglais connecté sur site : **3/3 verts** (`108-langues-sur-site`, connexions comprises, aucun incident ni appel Supabase). Nuage : **NON TESTÉ** (V155 non déployée, choix du PO de rester en local) |
| AC09 | **PASS** (après décision D-I18N-011) | Détection clé / variable : cas négatif ; nouveau littéral : autotest ESLint 2/2 ; budget : **277,5 Ko gzip pour un plafond de 278,3** (référence 256,3 + 22 validés par le PO), contrôlé en CI par `npm run i18n:budget` | Le budget initial de +10 Ko était dépassé (+21,1) ; seuil changé par décision du PO, consignée, et non en silence |
| AC10 | **PASS** | Test complet en base jetable (§4 de `QERP_I18N_MIGRATION_AND_ROLLBACK.md`) | — |
| AC11 | **PASS** | Captures 390 / 1440 px, clair / sombre, aucun défilement horizontal ; boutons de langue avec nom accessible, `aria-pressed`, `lang` | Pas d'audit axe automatisé |

## 7. Matrice de traçabilité

| Exigence | Document | Code | Test | Statut |
|---|---|---|---|---|
| D-001 fr / en | registre, baseline | `languages` V155, catalogues | `catalogs.test.ts`, `i18n:check` | fait |
| D-002 i18next | architecture, baseline | `src/i18n/index.ts` | `language-switch.test.tsx` | fait |
| D-003 langue / locale / fuseau | spécification, modèle | V155, `locale-format.ts`, `LanguageProvider` | `LanguesEtFormatsIT`, `locale-format.test.ts` | fait |
| D-004 HINT / DETAIL | architecture | V155, `PublicErrorDetails`, `errors.ts`, Edge | `PublicErrorDetailsTest`, `errors.test.ts`, IT | fait (13 sites) |
| D-005 hybride | modèle | — | — | phase 2 |
| D-006 en-GB, 4 locales | registre | `supported_locales`, catalogues `en` | `locale-format.test.ts` | fait |
| D-007 langue documentaire | spécification | `request_document_edition`, `DocumentEditions` | `factureEnAnglais`, worker | fait |
| D-008 LMC progressif | LMC | onglet « Langues et formats » | Playwright | fait (MVP) |
| D-009 tests FR + EN | stratégie de test | `test-utils.ts`, configs `fr-FR` | suites FR vertes, spec EN | fait |
| D-010 benchmark | analyse des écarts | — | — | non vérifié (non bloquant) |
| C-01 clés | normes, architecture | registre `error-keys.json` | `i18n:check`, `PublicErrorDetailsTest` | fait |
| C-02 formats | spécification | `locale-format.ts`, `useTenantCurrency` | `locale-format.test.ts` | fait (pilote) |
| C-03 modèle / sécurité | modèle | V155 | `LanguesEtFormatsIT`, retour arrière | fait |
| C-04 contrat d'erreur | architecture | Java, front, Edge | idem AC05 | fait |
| C-05 documents | spécification | V155, renderers | AC06 | fait (réserves) |
| C-06 tests / CI | stratégie de test | `verifier-i18n.mjs`, `eslint.config.js`, CI | cas négatifs | fait ; budget FAIL |
| C-07 charges / gates | feuille de route, backlog | — | — | fait |

## 8. Fichiers

**Créés** : `services/api/src/main/resources/db/migration/V155__langues_et_formats.sql`, sa jumelle Supabase,
`services/api/src/main/resources/i18n/error-keys.json`, `platform/PublicErrorDetails.java`,
`modules/shell/LanguageController.java`, `LanguesEtFormatsIT.java`, `platform/PublicErrorDetailsTest.java`,
`src/i18n/` (index, errors, nav-keys, ready-routes, LanguageProvider, test-utils, 14 catalogues, 4 fichiers de
tests), `src/lib/locale-format.ts` (+ test), `src/hooks/use-language.ts`, `use-locale-format.ts`,
`use-tenant-currency.ts`, `src/components/LanguageSwitcher.tsx`, `LanguageSettingsPanel.tsx`,
`scripts/i18n/` (contrôle CI, générateur du menu, périmètre pilote, cliquet, retour arrière),
`tests/e2e/i18n-langues.spec.ts`, six documents `docs/i18n/`.

**Modifiés** : 40 fichiers suivis (824 insertions, 255 suppressions) — voir `git diff --stat` sur la branche.

**Dépendances** : `i18next` 27.2.9, `react-i18next` 18.0.3, `eslint-plugin-i18next` 6.1.5 (dev), versions exactes.

## 9. Mesures

| Mesure | Valeur |
|---|---|
| Clés source (fr) | 387 feuilles : nav 135, common 85, documents 56, settings 46, auth 31, sales 28, errors 6 (FR = EN, contrôlé) |
| Clés d'erreur enregistrées | 6 ; sites SQL porteurs d'une clé : 13 sur 2 248 |
| Premier écran | +21,1 Ko gzip (+19,5 sur le point d'entrée, +1,5 sur un composant partagé) |
| `"fr-FR"` codés en dur | 280 (cliquet) |
| Facture PDF/A anglaise | 145 817 octets, marqueur PDF/A part 2 présent ; polices Montserrat et Playfair Display référencées (incorporation non vérifiée : objets compressés) |

## 10. Risques résiduels

1. **Budget du premier écran** dépassé (FAIL AC09) : décision PO requise (P-I18N-02) ou travail d'allègement.
2. **Nuage non testé** : V155 n'est pas déployée sur Supabase (choix du PO). Sur site, les parcours français et le parcours anglais ont été rejoués ; 12 échecs français existent déjà sur le code d'origine et sont à corriger à part.
3. **Pièces émises** : nombres et dates non formatés, pas de montant en lettres anglais ; métadonnée de langue
   PDF/A non vérifiée dans le fichier.
4. **Mélange visible** dans les écrans non traduits (éditeur de lignes partagé en anglais) — annoncé, mais réel.
5. **Benchmark** non vérifié sur sources officielles (D-I18N-010) : à faire avant tout usage commercial.
6. Fins de ligne : les scripts d'édition ont écrit en CRLF ; remis en LF (50 fichiers) avant livraison.

## 11. Recommandation

**GO pour le PoC**, après la décision D-I18N-011 du PO (budget du premier écran porté à +22 Ko gzip, contrôlé en CI).
Tous les critères applicables sont PASS, sans régression détectée ni faille d'isolation. Le nuage reste **NON
TESTÉ** par choix du PO (V155 non déployée sur Supabase).

Ce GO valide le PoC seulement. La généralisation (phase 1B / 1C, backlog révisé ≈ 29 j hors traduction) et toute
mise en production restent des décisions distinctes du PO (§9 de l'instruction). Le PoC s'arrête ici.
