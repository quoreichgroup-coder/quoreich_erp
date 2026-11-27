# QERP — Registre des décisions i18n

Les dix décisions sont **validées par le Product Owner le 26 novembre 2026** : D-I18N-001 à 005 par
réponses successives en séance, D-I18N-006 à 010 par l'instruction « Consolidation i18n / l10n et lancement
du Proof of Concept » du même jour. Une décision validée ne se rouvre qu'avec un motif documenté dans ce
registre. Les propositions techniques nées pendant le PoC (section « Propositions ») ne sont **pas** des
décisions du PO tant qu'il ne les a pas validées.

| ID | Décision validée | Conditions | Mise en œuvre PoC | Statut |
|---|---|---|---|---|
| D-I18N-001 | Français source `fr` et anglais `en` pour le MVP | Langues supplémentaires différées | `languages` (V155) : fr source, en actif | **Validée** 26/11/2026 |
| D-I18N-002 | i18next + react-i18next | Namespaces par module, chargement paresseux, traduction hors composants | `src/i18n/index.ts`, `tr()` pour les toasts | **Validée** 26/11/2026 |
| D-I18N-003 | Langue, locale et fuseau indépendants | Préférences plateforme, société, utilisateur et tiers selon contexte ; dates comptables inchangées | `tenants` / `profiles` / `customers` (V155), `my_language_context()`, `locale-format.ts` | **Validée** 26/11/2026 |
| D-I18N-004 | Messages SQL : clé dans HINT, paramètres dans DETAIL, texte FR de repli | Compatibilité Java et Supabase ; paramètres publics filtrés | `PublicErrorDetails` (Java), `src/i18n/errors.ts`, registre `i18n/error-keys.json` | **Validée** 26/11/2026 |
| D-I18N-005 | Modèle hybride | JSONB pour référentiels globaux, tables relationnelles par entité société, RLS | Non nécessaire au PoC (phase 2) ; préférences et langues autorisées seulement | **Validée** 26/11/2026 |
| D-I18N-006 | Catalogue anglais unique, orthographe britannique | Locales fr-BF, fr-FR, en-GB, en-US indépendantes ; glossaire commun | `supported_locales` (V155), catalogues `en` en orthographe GB | **Validée** 26/11/2026 |
| D-I18N-007 | Langue documentaire proposée depuis le tiers et choisie avant émission | Langue, locale et version figées ; aucun changement aux documents historiques | `request_document_edition(…, _language)`, `issued_documents.language/locale`, contexte `meta` haché | **Validée** 26/11/2026 |
| D-I18N-008 | LMC progressif | Onglet simple au MVP, LMC société en Commercial Stable, IA en Enterprise ; catalogues globaux versionnés dans le dépôt | Onglet « Langues et formats » ; catalogues JSON dans `src/i18n/locales` | **Validée** 26/11/2026 |
| D-I18N-009 | Conserver les tests FR et étendre les tests EN | Couvrir les processus critiques ; ne pas affaiblir les assertions existantes | Suites FR inchangées (catalogues FR = textes d'origine) ; tests EN ajoutés | **Validée** 26/11/2026 |
| D-I18N-010 | Vérification du benchmark ERP sur sources officielles | Avant usage commercial, non bloquant pour le PoC ; ne pas inventer de références | Non faite (aucune source consultée en ligne) : statut « à vérifier » conservé | **Validée** 26/11/2026 |
| D-I18N-011 | Budget du premier écran : référence avant i18n (256,3 Ko gzip) **+ 22 Ko** | i18next (16,2 Ko gzip) doit être chargé au premier rendu ; plafond contrôlé en CI | `scripts/i18n/budget-entree.json`, `npm run i18n:budget` (job `client-web`, après la construction) | **Validée** 26/11/2026 (PO, remplace le +10 Ko de la stratégie de test) |

## Propositions techniques du PoC (à valider par le PO, non décidées)

| ID | Proposition | Motif | Impact |
|---|---|---|---|
| P-I18N-01 | Droit `languages.settings` (et non `i18n.settings`) | Le catalogue n'accepte que des lettres dans le préfixe de module (`^[a-z]+\.`) | Nom du droit seulement |
| P-I18N-02 | *(devenue D-I18N-011)* Budget du premier écran révisé à **+22 Ko gzip** (mesuré +21,1) au lieu de +10 | i18next pèse à lui seul 16,2 Ko gzip une fois minifié (mesuré) et doit être présent au premier rendu | Voir rapport d'exécution, AC09 |
| P-I18N-03 | Avertissement explicite sur les écrans pas encore traduits (`UntranslatedNotice`) | C-07 : pas de module partiellement traduit sans information explicite | Une ligne en tête des écrans hors périmètre |
| P-I18N-04 | Pièces émises : libellés traduits, montants et dates bruts (comme V141) tant que le formatage par locale des documents n'est pas livré | Le formatage figé dans le contexte est un lot à part (1B) | Facture EN lisible, nombres non formatés |

## Historique

- 26/11/2026 matin : audit et dix propositions ; D-I18N-001 à 005 validées une par une.
- 26/11/2026 après-midi : D-I18N-006 à 010 validées par l'instruction de consolidation ; corrections C-01 à C-07 intégrées ; PoC exécuté (voir `QERP_I18N_POC_EXECUTION_REPORT.md`).
