# QERP — Modèle de données i18n

Proposition à valider. Aucune migration n'est écrite. Toute migration future suivra les règles du dépôt :
jumeaux Flyway / Supabase identiques, `install_tenant_isolation_triggers()` après toute FK entre tables
société, droits du catalogue, pas de règle codée en dur.

## 1. Préférences

```sql
-- Langues actives de la plateforme (référence globale)
CREATE TABLE public.languages (
  code        text PRIMARY KEY CHECK (code ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?$'),  -- BCP 47 langue (+ script)
  label       text NOT NULL,          -- autonyme : « Français », « English »
  direction   text NOT NULL DEFAULT 'ltr' CHECK (direction IN ('ltr','rtl')),
  is_active   boolean NOT NULL DEFAULT false,
  is_source   boolean NOT NULL DEFAULT false  -- une seule : fr
);

ALTER TABLE public.tenants
  ADD COLUMN default_language text REFERENCES public.languages(code),   -- NULL = plateforme
  ADD COLUMN default_locale   text CHECK (default_locale ~ '^[a-z]{2}-[A-Z]{2}$'),
  ADD COLUMN timezone         text;   -- IANA, contrôlé contre pg_timezone_names

ALTER TABLE public.profiles
  ADD COLUMN language text REFERENCES public.languages(code),   -- NULL = société
  ADD COLUMN locale   text CHECK (locale ~ '^[a-z]{2}-[A-Z]{2}$');

ALTER TABLE public.customers ADD COLUMN document_language text REFERENCES public.languages(code);
ALTER TABLE public.suppliers ADD COLUMN document_language text REFERENCES public.languages(code);
ALTER TABLE public.employees ADD COLUMN document_language text REFERENCES public.languages(code);
```

- `profiles.language` / `locale` sont modifiables par l'utilisateur lui-même : **ce ne sont pas des colonnes de
  sécurité**, mais le garde `trg_guard_profile_tenant` (V24) doit rester intact.
- `tenants.*` : écriture par la fonction `set_company_identity` (V47) étendue, droit admin société.

## 2. Options pour les données traduisibles

| Option | Avantages | Inconvénients | Verdict |
|---|---|---|---|
| A. Colonnes par langue (`label_fr`, `label_en`) | simple, rapide | une migration par langue ; ne passe pas à l'échelle | Rejetée |
| B. Table de traduction par entité (`<table>_translations`) | intégrité par FK, RLS et isolation société natives, index par langue, modèle Oracle MLS / SAP | une table par entité traduisible | **Retenue pour les données société** |
| C. JSONB (`label_i18n jsonb`) | une colonne, lecture simple (`label_i18n->>'en'`), modèle Odoo | intégrité et validation par CHECK seulement, recherche moins indexable, personnalisation société impossible sans dupliquer la ligne | **Retenue pour les référentiels globaux livrés** (rare en écriture) |
| D. Table générique (`translations(entity, entity_id, field, lang, value)`) | une seule table | aucune FK réelle, contraire à V55 (isolation vérifiée par FK) | Rejetée |
| E. Service centralisé distant | indépendant de la base | dépendance réseau par libellé, contraire au §16 du cahier | Rejetée |

**Recommandation hybride (D-I18N-005)** : C pour les référentiels système livrés, B pour les référentiels et
données société, et une table de **surcharge société** pour les libellés globaux.

## 3. Référentiels système (globaux, livrés)

```sql
ALTER TABLE public.erp_permission_catalog ADD COLUMN label_i18n jsonb NOT NULL DEFAULT '{}'
  CHECK (jsonb_typeof(label_i18n) = 'object');
-- idem : erp_system_roles, posting_roles, accounting_journals, fiscal_modules, report_lines,
--        annex_notes (title), shipment_event_codes, framework_reference_accounts, syscohada_reference_accounts
```

- La colonne `label` existante **reste la source française** : aucune lecture actuelle ne casse.
- Lecture : `COALESCE(label_i18n->>_lang, label)` via une fonction `i18n_label(label, label_i18n, lang)` IMMUTABLE.
- Écriture : par migration uniquement (données de version), jamais par un utilisateur.

## 4. Référentiels et données société

Modèle type (à répéter pour chaque entité retenue) :

```sql
CREATE TABLE public.landed_cost_type_translations (
  tenant_id   uuid NOT NULL,
  type_id     uuid NOT NULL,
  language    text NOT NULL REFERENCES public.languages(code),
  label       text NOT NULL CHECK (btrim(label) <> ''),
  description text,
  status      text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','in_review','approved','published')),
  updated_by  uuid, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (type_id, language),
  FOREIGN KEY (type_id, tenant_id) REFERENCES public.landed_cost_types (id, tenant_id) ON DELETE CASCADE
);
-- RLS : lecture société ; écriture droit i18n.translate ; puis SELECT public.install_tenant_isolation_triggers();
```

Candidats, par priorité : catégories de pièces jointes (V138), types de frais d'approche (V129), références RH
(V83), catégories de notes de frais (V109), catégories de risques (V113), modèles de relance (`ar_dunning_rules`)
puis, selon le besoin commercial, articles et services (`items`).

La langue d'origine de la ligne est la langue société au moment de la création ; la ligne principale n'est
jamais dupliquée.

## 5. Surcharges société des libellés globaux

```sql
CREATE TABLE public.tenant_label_overrides (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  namespace text NOT NULL,              -- 'sales', 'catalog.permission', ...
  key       text NOT NULL,
  language  text NOT NULL REFERENCES public.languages(code),
  value     text NOT NULL,
  status    text NOT NULL DEFAULT 'draft',
  PRIMARY KEY (tenant_id, namespace, key, language)
);
```

Clés réservées (mentions légales, montant en lettres, libellés fiscaux) refusées par un garde.

## 6. Documents émis

- `document_renders.context` (V141) reçoit `language`, `locale` et les libellés résolus **avant** le calcul de
  `context_sha256` : la réimpression reste byte-identique.
- `document_template_versions` : colonne `language` ; défaut par type et par langue (prolonge V144).
- Documents émis avant la migration : réputés `fr` / `fr-FR` (valeur explicite écrite par la migration, pas déduite).

## 7. Migration réversible

1. Ajouter colonnes et tables **nullables / vides** : aucun comportement ne change (NULL = règle actuelle).
2. Remplir les traductions `en` des référentiels globaux par migration de données.
3. Brancher la lecture (`i18n_label`) dans les vues et RPC, avec repli sur `label`.
4. Retour arrière : les lectures retombent sur `label` ; les colonnes ajoutées peuvent être supprimées sans perte
   des données métier (seules des traductions sont perdues).

## 8. Ne jamais traduire

Codes (`module.action`, `QGxxx`, comptes, journaux `VT/AC/BQ`), numéros de pièce, références externes,
désignations saisies dans une transaction, libellés d'écritures, documents émis.

## Note de consolidation — 26 novembre 2026, après-midi (C-03) — modèle réellement livré en V155

- `languages` : code = sous-étiquette BCP 47 canonique, **validation par appartenance au référentiel** (clé
  étrangère), pas par expression régulière ; **une seule langue source** (index unique partiel sur `is_source`) ;
  garde `trg_guard_source_language` : la source ne peut être supprimée, désactivée ni remplacée.
- `supported_locales` : liste des locales réellement disponibles (fr-BF, fr-FR, en-GB, en-US) ; `languages.default_locale`.
- `tenant_languages` : langues autorisées par société ; **aucune ligne = toutes les langues actives** ; une liste
  non vide contient toujours la langue source. Lecture sous RLS par la société ; écriture uniquement par
  `set_company_language_settings` (droit `languages.settings`).
- `tenants.default_language / default_locale / timezone` (fuseau IANA contrôlé sur tous les chemins par trigger),
  `profiles.language / locale` (garde de langue autorisée sur tous les chemins ; garde V24 intact),
  `customers.document_language`.
- Résolution côté serveur, `my_language_context()` : préférence autorisée > société > plateforme > source ; une
  langue retirée ou désactivée est **ignorée, jamais réécrite** (repli).
- Documents : `document_templates.language` (NOT NULL, `fr` pour l'existant — c'est la langue réelle du gabarit
  V141), `issued_documents.language / locale` (NULL pour les éditions antérieures, aucune ligne existante
  modifiée), contexte `meta` (langue, locale, version du modèle) ajouté **avant** le hachage des seules nouvelles éditions.
- Tables de traduction société (`*_translations`) : phase 2. Spécification retenue pour leur livraison : FK
  composites, RLS, isolation V55 (`install_tenant_isolation_triggers()`), statut contraint `draft` → `in_review` →
  `approved` → `published` avec défaut `draft`, lecture courante **uniquement** de la version publiée, langue
  source stockée explicitement sur la ligne (jamais déduite de la préférence actuelle de la société).
- Retour arrière : voir `QERP_I18N_MIGRATION_AND_ROLLBACK.md` (non destructif, testé).
