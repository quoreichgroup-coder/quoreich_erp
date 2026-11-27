# QERP — Normes de traduction

## 1. Clés

- Forme : `<namespace>:<zone>.<élément>[.<variante>]`, en anglais, `snake_case`, jamais le texte lui-même.
  Exemples : `sales:quotation.actions.confirm`, `common:status.draft`, `errors:QG001.account_missing`.
- Un namespace par module du menu (`navigation.ts`) + `common` + `errors` + `documents`.
- Statuts : `common:status.<code>` pour les génériques, `<module>:status.<code>` pour les propres au module.
- Pas de clé construite dynamiquement à partir de données utilisateur ; les codes base (`draft`) sont autorisés
  s'ils sont dans une liste fermée typée.

## 2. Interpolation et pluriels

- Variables nommées : `{{count}}`, `{{number}}`, `{{amount}}` ; jamais de concaténation de phrases.
- Les montants et dates sont formatés **avant** interpolation par `locale-format.ts`.
- Pluriels CLDR : `_one`, `_other` (et les formes supplémentaires pour l'arabe le moment venu).

## 3. Style français (source)

- Typographie française : espace insécable avant `: ; ? !`, guillemets « », pas de majuscule de titre.
- Vocabulaire SYSCOHADA / OHADA : « écriture », « pièce », « exercice », « lettrage », « à-nouveaux ».
- Phrases d'erreur : dire ce qui est refusé et quoi faire (style déjà en place dans les messages QG).

## 4. Style anglais

- Anglais international (en-GB pour l'orthographe par défaut [H, à valider : D-I18N-006]).
- Glossaire comptable figé : écriture = *journal entry*, pièce = *document*, lettrage = *matching*,
  à-nouveaux = *opening balances*, exercice = *fiscal year*, avoir = *credit note*, acompte = *advance*,
  relance = *dunning*, DA = *purchase requisition*, BC = *purchase order*, BL = *delivery note*.
- Termes OHADA sans équivalent (RCCM, IFU, SYSCOHADA) : non traduits, éventuellement glosés.

## 5. Ne jamais traduire

Codes et identifiants, numéros de pièce, numéros de compte, codes journaux, codes QG, noms de sociétés et de
tiers, données saisies, contenus de documents émis.

## 6. Mise en page

- Prévoir +30 % de longueur (anglais → français est l'inverse, mais l'allemand ou le portugais allongent).
- Pas de largeur fixe sur les boutons ; `truncate` + `title` pour les cellules de tableau.
- Propriétés logiques Tailwind (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`) dans le nouveau code, pour le RTL.

## 7. Accessibilité

Les `aria-label` sont traduits comme le texte visible ; ne jamais remplacer un texte visible par un `aria-label`
différent (règle déjà retenue au lot F1, V75).

## 8. Revue

Toute nouvelle chaîne visible passe par `t()` ; la revue de code refuse un littéral visible dans un composant
(contrôle CI, voir stratégie de test).

## Note de consolidation — 26 novembre 2026, après-midi (C-01)

- Clés d'erreur : `errors:<domaine>.<cas>` (jamais le code QG dans la clé, jamais de préfixe `i18n:`).
- Clés du menu : dérivées de l'adresse (`nav:item.sales__transactions`, `nav:item.settings__tab_fiscal`) ;
  `__` remplace `/` pour éviter les hiérarchies i18next accidentelles. Le catalogue du menu est généré
  (`npm run i18n:menu`) et un test vérifie qu'il reste identique à `src/lib/navigation.ts`.
- Pluriels : `_one` / `_other` obligatoires ensemble (contrôle CI).
- Fichiers du périmètre traduit : règle ESLint `i18next/no-literal-string` en **erreur** (liste
  `scripts/i18n/perimetre-pilote.js`) ; exceptions limitées aux signes, sigles en capitales, identifiants techniques
  en minuscules et chemins d'URL.
