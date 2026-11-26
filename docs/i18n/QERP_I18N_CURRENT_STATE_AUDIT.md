# QERP — Audit de l'existant i18n / l10n

Audit en lecture seule du 26 novembre 2026, branche `codex/finaliser-module-rh-paie`, schéma à V145.
Légende : **[V]** vérifié dans le dépôt (commande ou fichier cité) · **[H]** hypothèse · **[ND]** non disponible.

## 1. Synthèse

QERP est aujourd'hui **monolingue français, mono-locale `fr-FR`, sans aucune infrastructure i18n**. Rien
n'est traduisible sans toucher au code : ni les écrans, ni les messages de la base, ni les documents, ni
les prompts IA. En revanche, plusieurs fondations sont saines et réutilisables : statuts et droits stockés
en **codes** indépendants de la langue, erreurs portant un **SQLSTATE** stable, règles fiscales et de paie
portées par des **paramètres pays** distincts de toute notion de langue, et documents émis **figés** (V141).

## 2. Technologies réelles

| Élément | Constat | Preuve |
|---|---|---|
| Front | React 19 + TypeScript, Vite 8, Tailwind 4, shadcn/ui | `package.json`, `CLAUDE.md` [V] |
| Bibliothèque i18n front | **Aucune** (ni i18next, react-intl, lingui) | `package.json` : seule `date-fns` 3.6 [V] |
| Back | Java 25 / Spring Boot 4.1 (`services/api`) + PostgreSQL (logique en PL/pgSQL) ; nuage = Supabase | `services/api/pom.xml` [V] |
| i18n Java | **Aucun** `MessageSource`, `LocaleResolver`, `ResourceBundle`, `Accept-Language` | grep sur `services/api/src` : 0 résultat [V] |
| Mobile | **Aucune application** (pas de React Native / Expo) | arborescence racine, aucun `app.json` [V] |
| Edge functions | Deno : `ai-*`, `ar-dunning`, `document-render`, `import-data`, `bceao-rates`, `tracking-webhook` | `supabase/functions/` [V] |
| Rendu PDF serveur | Gotenberg 9.2, polices Montserrat / Playfair | `infra/pdf/compose.yml` [V] |

## 3. Inventaire des textes codés en dur (front)

Mesures heuristiques par `rg` (hors tests), donc ordres de grandeur, pas des comptes exacts.

| Zone | Textes JSX accentués | Chaînes accentuées | Toasts | Remarque |
|---|---|---|---|---|
| `src/pages` (115 pages) | 1 051 | 1 775 | 70 | |
| `src/components` | 662 | 861 | 65 | |
| `src/hooks` | 0 | 393 | 457 | messages de mutation |
| `src/lib` | 0 | 340 | 2 | messages métier, libellés de statut |
| **Total** | **≈ 1 700** | **≈ 3 370** | **≈ 594** | + 896 attributs `placeholder/title/aria-label/label` |

Autres constats :
- `"fr-FR"` codé en dur : **271 occurrences dans 160 fichiers** ; `toLocale*String(` : 272 ; `Intl.NumberFormat` : 9 [V].
- **95 fichiers** déclarent leur propre formateur local (`const fmt = …`) : aucun formateur central de montant, de date ou de nombre [V].
- `"XOF"` codé en dur : 44 occurrences, alors que la devise est un paramètre société (`tenants.currency`) [V].
- ≈ 70 fichiers contiennent des tables de libellés de statut (`Record<string,string>`) : les statuts sont des codes (`draft`, `approved`…) traduits localement, donc un **bon point de départ** [V].
- `date-fns/locale` est importé dans 4 fichiers seulement (`AccountsPayable.tsx`, `AiSchedulesSettings.tsx`, `AiHistory.tsx`, `UpcomingPayments.tsx`) [V].
- 27 libellés visibles restent **en anglais** (« New Requisition », « New PO »…) : l'interface est déjà mixte [V].
- `index.html:2` : `<html lang="fr">` fixe [V].
- Zod n'est utilisé que dans 7 fichiers ; ses messages par défaut sont anglais [V].
- Menu : `src/lib/navigation.ts` (8 groupes, libellés FR dans le code) [V].

## 4. Formats régionaux

| Sujet | Constat | Preuve |
|---|---|---|
| Nombres / montants | `fr-FR` partout ; U+202F neutralisé pour le PDF par `pdfSafe` | `src/lib/pdf-export.ts:9` [V] |
| Dates | `dateFr` (JJ/MM/AAAA) pour les documents ; ailleurs `toLocaleDateString("fr-FR")` | `src/lib/document-pdf.ts:259` [V] |
| Montant en lettres | Français uniquement, règles d'avant 1990 | `src/lib/document-pdf.ts:91` [V] |
| CSV | Séparateur `;`, virgule décimale codés en dur (choix délibéré pour Excel FR) | `src/lib/csv-export.ts:7-10` [V] |
| Fuseau horaire | Aucun paramètre ; 287 `current_date` côté SQL (fuseau du serveur, UTC sur Supabase [H]) ; quelques `timeZone: "UTC"` côté front | migrations, `use-consolidated-trends.ts:32` [V] |
| Devises | Bien traitées **comme données métier** : `exchange_rates`, `currency_settings`, devise par tiers et par pièce (V124–V128) | migrations V124–V130 [V] |
| Pays | Colonnes ISO-2 sur fournisseurs (V56), entrepôts (V132), tarifs douaniers (V129), référentiels (V64), paie (`hr_payroll_settings.country`) | [V] |

## 5. Base de données

- **Aucune colonne de langue, de locale ni de fuseau** dans le schéma (`profiles`, `tenants`, `customers`, `suppliers`) [V].
  `profiles` = `id, tenant_id, full_name, avatar_url` (`V5__public_tables.sql:1495`) ; `tenants` = `name, currency, fiscal_year_start, status` + identité légale V47.
- **Libellés de référence en français dans des colonnes uniques** : `erp_permission_catalog.label`, `erp_system_roles.label` (V23), `posting_roles` (V18), `accounting_framework_accounts` (V18), `accounting_journals` (V38), `fiscal_modules` (V33), `report_lines` (V63), `annex_notes` (V123), `shipment_event_codes` (V131), `landed_cost_types` (V129), `attachment_categories` (V138), `hr_movement_references` (V83), `syscohada_reference_accounts` (V60), `framework_reference_accounts` (V64) [V].
- **Messages d'erreur métier en français dans le PL/pgSQL** : 2 216 `RAISE EXCEPTION`, ≈ 1 900 textes distincts, 144 codes `QGxxx` [V]. Le code (SQLSTATE) est stable et indépendant de la langue ; **le texte, lui, est l'unique porteur du sens détaillé** (compte manquant, quantité restante…).
- Données métier libres (désignations d'articles, libellés d'écritures, notes) : monolingues par nature, à ne pas traduire [V].

## 6. API Java

- `DatabaseRefusalAdvice` renvoie `{"code": SQLSTATE, "error": <message de la base>}` : la langue de l'erreur est **celle du PL/pgSQL** (`platform/DatabaseRefusalAdvice.java:34-58`) [V].
- ≈ 718 chaînes françaises dans `services/api/src/main/java` (messages de refus, journal) [V].
- Le contrat OpenAPI ne déclare aucun en-tête `Accept-Language` [V].

## 7. Documents, notifications, IA

| Canal | Constat | Preuve |
|---|---|---|
| PDF client (front) | `printDocumentPDF` : libellés FR fixes, montant en lettres FR | `src/lib/document-pdf.ts` [V] |
| Modèles serveur V141/V143 | HTML généré par PostgreSQL avec `<html lang="fr">` fixe ; contexte figé (`context jsonb`, `context_sha256`) **sans langue ni locale** | `V141…sql:38-43, 168` [V] |
| Relances e-mail | Texte libre par règle (`ar_dunning_rules.template`) et événement figé (`ar_dunning_events`) ; messages techniques FR dans `ar-dunning` | `V5…:348`, `supabase/functions/ar-dunning/index.ts` [V] |
| IA | Prompts système imposant « en français » dans les deux edge functions **et** dans `AiAnalyses.java:146,238` | [V] |

## 8. Tests

- 1 293 sélecteurs E2E Playwright par libellé français (`getByRole({name})`, `getByText`, `getByLabel`) et 154 dans Vitest [V].
  Toute traduction ou renommage de clé casserait ces tests si l'on change de stratégie de sélection : **risque majeur de régression des parcours**.
- Aucun contrôle CI de couverture de traduction [V].

## 9. Modules : disponibles et prévus

| Module (prompt) | État dans le dépôt |
|---|---|
| Finance, Comptabilité, Immobilisations, Budget, RH, Paie, Achats, Approvisionnement, Stocks, Ventes, CRM, Trésorerie, Notes de frais, Projets, Conformité, Risques, Administration | **Disponibles** [V] |
| Contrôle de gestion | Partiel : analytique (V19), budgets, projets [V] |
| Reporting / BI | Rapports par module + états SYSCOHADA ; pas d'outil BI [V] |
| Workflows / Approbations | Circuits par module (achats, AP, notes de frais, paie) ; `workflow_rules` en lecture seule (V116) [V] |
| Business AI HUB | Deux analyses (trésorerie, anomalies GL) + planification [V] ; pas de « hub » [ND] |
| EAM, Maintenance Planning, Downtime, Fleet, Production | **Absents** (aucune table, route ni écran) [V] |
| Mobile | **Absent** [V] |

## 10. Limites de l'audit

- Comptes de chaînes heuristiques (regex) : marge d'erreur estimée ± 15 % [H].
- Le fuseau effectif de la base Supabase n'a pas été interrogé (pas d'accès SQL dans cette session) [ND].
- Benchmark ERP rédigé à partir de connaissances documentaires, **sans consultation en ligne dans cette session** : voir `QERP_I18N_GAP_ANALYSIS.md` §2.

## Note de consolidation — 26 novembre 2026, après-midi (C-01, C-07)

Le texte ci-dessus reste la photographie du matin (branche `codex/finaliser-module-rh-paie`, V145). Vérifications
faites avant le PoC, sans réécrire les constats :

- **État du dépôt** : HEAD `7392c6c`, migrations jusqu'à **V154** (V146–V154 ajoutées depuis l'audit : accès aux
  modules, paie et RH). Le PoC part d'une branche dédiée `i18n/poc-langues` et ajoute V155.
- **Inventaire des erreurs SQL corrigé** : le « 144 codes QG » de l'audit est un artefact de mesure (`rg -o` préfixe
  chaque correspondance du nom de fichier ; `sort -u` comptait des couples fichier × code). Mesures refaites :
  **2 248 sites `RAISE EXCEPTION`** (redéfinitions successives comprises, donc majorant), **1 204 messages
  littéraux distincts** (minorant : les messages construits dynamiquement ne sont pas comptés), **38 codes `QG`
  distincts**. Un SQLSTATE ne désigne pas un message : QG001 seul couvre des dizaines de formulations.
- **« ≈ 1 900 messages »** de l'audit : même biais (préfixe de fichier) ; remplacé par les 1 204 ci-dessus.
- **Locales codées en dur** : 280 occurrences de `"fr-FR"` dans `src/` hors `src/i18n` et `locale-format.ts`
  après le PoC (cliquet CI : ce nombre ne peut plus augmenter).
- **95 HINT** existants sont du texte libre français : la convention de clé doit les distinguer (C-01).
- **Modules absents confirmés** : EAM, Downtime, Fleet, Production, Mobile. La mémoire du projet indique que le PO
  les veut au MVP sous forme d'aperçus réduits : ils devront naître traduisibles (règle de la feuille de route).
