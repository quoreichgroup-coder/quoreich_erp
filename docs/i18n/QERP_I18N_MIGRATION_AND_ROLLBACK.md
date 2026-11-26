# QERP — Migration et retour arrière i18n

## 1. Migration V155 (`langues_et_formats`)

- Flyway : `services/api/src/main/resources/db/migration/V155__langues_et_formats.sql`.
- Supabase (jumelle, SQL exécutable identique) : `supabase/migrations/20261126110000_a8071509-469c-4e78-a339-3f48c15621d5.sql`.
- `npm run db:check-twins` : 139 paires synchronisées (V16..V155).
- Se termine par `SELECT public.install_tenant_isolation_triggers();` (règle V55) et `NOTIFY pgrst`.
- **Non déployée** : ni sur le projet Supabase du propriétaire, ni sur `qerp_reel`. Le déploiement cloud passe par
  `deploy-supabase.sh` et exige l'accord explicite du PO (règle de la mémoire du projet).

### Effets sur l'existant (mesurés)

| Objet | Effet |
|---|---|
| Données métier | aucun (empreinte identique avant / après, §4) |
| Éditions déjà émises | aucune ligne modifiée ; `language` / `locale` NULL = « antérieure » ; contexte, empreintes et PDF inchangés |
| Modèles existants | `language = 'fr'` (langue réelle du gabarit V141) ; HTML et empreinte inchangés ; le gabarit français généré par la nouvelle fonction est identique octet pour octet à l'ancien |
| Fonctions remplacées | `save_document_template` et `request_document_edition` (un paramètre facultatif ajouté : appels existants valides), `require_posting_account` et `on_ar_invoice_posted` (même corps, HINT / DETAIL porteurs de clé), `document_render_snapshot` (ligne vide en anglais pour les seules éditions anglaises) |
| Catalogue des droits | `languages.settings` (admin) ; 154 droits |

## 2. Ordre de déploiement

1. API Java et front ensemble (le front lit `key` / `params` s'ils existent, ignore leur absence : il fonctionne
   aussi contre une base sans V155, en français).
2. Migration V155 (sur site par Flyway au démarrage de l'API ; nuage par `deploy-supabase.sh`).
3. Fonctions Edge `document-render` (langue transmise et métadonnée PDF/A) — non déployée à ce jour.
4. Régénération des types Supabase (`src/integrations/supabase/types.ts`) : les nouvelles tables sont lues par
   `(supabase as any)` en attendant.

## 3. Retour arrière (non destructif)

Principe : **on désactive, on ne supprime pas**, et on ne réécrit jamais V155.

| Niveau | Action | Effet |
|---|---|---|
| A. Langue | `scripts/i18n/retour-arriere-v155.sql` (simulation par défaut ; `psql -v appliquer=true`), à reprendre en migration corrective V156+ si besoin | l'anglais redevient inactif ; préférences conservées mais ignorées (repli `fr`) ; éditions anglaises intactes ; nouvelle émission anglaise refusée (QG039), jamais produite en français à l'insu de l'utilisateur |
| B. Société | `set_company_language_settings(…, ARRAY['fr'])` | une société revient au français seul, sans toucher aux autres |
| C. Code | revenir au commit précédent du front et de l'API | le schéma V155 reste en place et inoffensif (colonnes nullables, fonctions compatibles) |
| D. Réactivation | `UPDATE languages SET is_active = true WHERE code = 'en'` (migration) | toutes les préférences conservées redeviennent effectives |

Aucune de ces actions ne supprime une préférence, une traduction, une édition ou une donnée métier.

## 4. Test de retour arrière (exécuté le 26 novembre 2026)

Base PostgreSQL 18.6 jetable reconstruite de V1 à V154, jeu synthétique (société, utilisateur admin, client,
facture émise, modèle publié, édition archivée), puis :

| Étape | Résultat |
|---|---|
| 1. Avant V155 | empreinte métier `1b5ff447…`, édition `FV-RB-1/ED-1` (contexte `763f448e…`, empreinte vérifiée), modèle `9940c542…` |
| 2. Après V155 | **identique à 1** ; édition antérieure `language = NULL`, modèle `fr` |
| 2b. Édition anglaise | remplacement `FV-RB-1/ED-2` émis en `en / en-GB`, prêt, empreinte vérifiée |
| Préférences `en` | profil, société, client ; résolution = `en` |
| Simulation | rien modifié ; résolution toujours `en` |
| Retour arrière appliqué | résolution = **`fr`** ; préférences **conservées** (`en/en-GB`, `en`, `en`) ; nouvelle émission anglaise refusée : « Langue non autorisée pour cette société : en » |
| 3. Après retour arrière | **identique à 2b** (données métier, éditions FR et EN, modèles) |
| Réactivation | résolution = `en` |

Scripts : `scripts/i18n/retour-arriere-v155.sql` (livré) ; jeu de données et photographies dans `.tmp_i18n/`
(non versionnés). Les conteneurs ont été détruits après le test.
