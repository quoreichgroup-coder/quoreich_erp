# Migrations Flyway — schéma `public`

## Provenance

Ces migrations ne sont pas écrites à la main : elles sont **extraites du dump de
production** `flow-bright-desk_261109.backup` (PostgreSQL 17.6, 9 novembre 2026),
restauré dans un PostgreSQL 18.6 jetable, puis découpé par classes d'objets via
la liste TOC de `pg_restore`.

`supabase/migrations/` **n'est pas** la source : la fonction
`get_consolidated_cfo_trends`, utilisée par la page CFO, n'y figure pas — elle
n'existe que dans `drizzle/migrations/`. Le dump est la seule source vérifiable.

## Fichiers

| Fichier | Origine | Contenu |
|---|---|---|
| `V1__bootstrap_roles.sql` | écrit à la main | `anon`, `authenticated`, `service_role`, `qerp_api` |
| `V2__compat_auth_schema.sql` | écrit à la main | schéma `auth` : `uid()`, `jwt()`, `role()`, `email()`, `auth.users(id)` |
| `V3..V14__public_*.sql` | **générés** par `scripts/schema/extract-from-dump.sh` | types, séquences, tables, contraintes, index, fonctions, vues, règles, RLS, politiques, triggers, clés étrangères |
| `V15__privileges.sql` | écrit à la main | droits applicatifs |
| `V16__suppression_declencheurs_en_double.sql` | écrit à la main | retire 4 déclencheurs qui réexécutaient une fonction déjà branchée (paiements ×3, réceptions ×2, audit ×2) |
| `V17__comptabilisation_ar_refus_si_plan_incomplet.sql` | écrit à la main | facture émise et encaissement/paiement refusés (`QG001`) si un compte du plan manque, au lieu d'être acceptés sans écriture |
| `V18__parametrage_comptable.sql` | écrit à la main | référentiels comptables (SYSCOHADA révisé), rôles comptables, comptes par société ; la comptabilisation AR ne cite plus aucun numéro de compte |
| `V19__axes_analytiques.sql` | écrit à la main | axes analytiques par société (sections datées, règles obligatoire/interdit par préfixe de compte, défauts par client, imputation des lignes), contrôle `QG002` à la comptabilisation, contre-passation qui recopie l'analytique |
| `V20__hierarchie_analytique_sans_boucle.sql` | écrit à la main | interdit les boucles dans la hiérarchie des sections (A → B → A) |
| `V21__lignes_de_facture_et_codes_tva.sql` | écrit à la main | codes TVA par société (taux figé), lignes de facture aux montants calculés, comptabilisation regroupée par compte de vente et de TVA |
| `V22__numerotation_des_factures.sql` | écrit à la main | numéro de facture unique par société, attribué à l'émission depuis la série, compteur par année, sans trou |
| `V23__roles_centralises.sql` | écrit à la main | modèle d'autorisations unique (catalogue de droits, rôles système et sur mesure par société), lu par has_role / has_permission / has_*_perm, limité à la société ; anciennes fonctions gardées comme témoins legacy_* |
| `V24__societe_du_profil_protegee.sql` | écrit à la main | **sécurité** : un utilisateur ne peut plus changer lui-même la société de son profil (faille d'isolation entre sociétés héritée du schéma de production) |
| `V25__matrice_des_autorisations.sql` | écrit à la main | journal des changements d'autorisations tenu par la base, recopie des rôles système affectés depuis la matrice vers user_roles |
| `V26__regles_de_la_matrice.sql` | écrit à la main | règles de la matrice dans la base : jamais de société sans administrateur, rôle à revoir non affectable, rôle affecté non supprimable |
| `V27__mes_acces.sql` | écrit à la main | `my_access()` : rôles et droits de l'utilisateur dans sa société, lus par les écrans ; condition de société ajoutée à trois politiques qui fuyaient entre sociétés |
| `V28__ordre_du_journal_des_autorisations.sql` | écrit à la main | numéro d'ordre `seq` (identité) dans `erp_authorization_audit` : les événements d'une même transaction partageaient `created_at` et sortaient dans le désordre |
| `V29__conversion_opportunite_droit_du_catalogue.sql` | écrit à la main | `convert_opportunity_to_quote` vérifie `has_permission(…, 'crm.convert')` au lieu de `user_roles` (crm_manager/crm_admin) : l'administrateur voyait le bouton actif puis était refusé |
| `V30__declencheurs_ventes_achats_repares.sql` | écrit à la main | `enforce_sales_period_lock` et `seed_procurement_approval_queue` lisaient dans une même expression des colonnes propres à chaque table : devis, commandes clients, bons de livraison et soumissions à approbation des achats échouaient tous |
| `V31__roles_des_modules_et_invitations.sql` | écrit à la main | les 12 `assign_*_role` écrivent dans la matrice (`module_role_set`), cible vérifiée dans la société de l'appelant, séparation des tâches lue dans la matrice ; `tenant_invitations` + `create_tenant_invitation` / `revoke_tenant_invitation` ; `join_tenant` prend un code à usage unique et refuse un utilisateur déjà rattaché ; `create_tenant_for_user` de même |
| `V32__suppression_de_user_roles.sql` | écrit à la main | reprise dans la matrice de toute ligne de `user_roles` absente (société du profil si la ligne n'en avait pas), puis suppression des deux recopies, des sept témoins `legacy_*` et de `user_roles` |
| `V33__calendrier_fiscal_central.sql` | écrit à la main | calendrier fiscal central : `fiscal_years` / `fiscal_periods` / `fiscal_modules`, `period_locks` en lecture seule (modules normalisés), contrôle unique `assert_fiscal_period_open` (QG003) sur neuf modules, ordre de clôture bloquant, réouverture avec motif, droits `periods.close` / `periods.reopen`, journal ; clôtures de stock et de trésorerie réparées ; exercices civils repris pour les sociétés existantes |

**`V1..V15` = la base de référence**, identique au dump : c'est ce que
`verify-lot0.sh` compare, et il s'arrête à V15. **À partir de V16, ce sont des
évolutions** : chacune est écrite à la main, porte sa jumelle dans
`supabase/migrations/` tant que Supabase reste en production, et ses écarts au
manifeste sont déclarés un par un dans `SchemaMigrationIT` — jamais en réécrivant
le manifeste, qui reste la photographie du dump.

**Ne pas éditer `V3..V14` à la main.** Toute correction se fait en amont, puis
les fichiers sont régénérés : `verify-lot0.sh` échoue si un fichier versionné
diverge de la régénération.

## Ordre, et pourquoi il est contraint

`V1` doit précéder tout le reste : `CREATE POLICY ... TO authenticated` échoue si
le rôle n'existe pas, et PostgreSQL valide cette clause à la création.

`V2` doit précéder `V8` (les politiques et 122 corps de fonctions appellent
`auth.uid()`), `V12`, et `V14` (16 clés étrangères vers `auth.users`).

## Ce qui n'est pas rejoué

Les extensions `pg_cron`, `pg_net` et `supabase_vault` n'existent pas dans
PostgreSQL standard ; la publication `supabase_realtime` est propre à Supabase.
Abandonnés et remplacés : `cron` → Quartz, `storage` → MinIO,
`realtime` → SSE/WebSocket. Vérifié : **aucune fonction de `public` n'appelle
`net.`, `cron.`, `vault.`, `storage.` ou `realtime.`**

Les ACL d'origine ne sont pas rejouées (elles visaient des rôles Supabase
inexistants et accordaient `ALL` à `anon`). L'original est conservé dans
`scripts/schema/reference/acl-original.sql` ; les droits effectifs sont écrits
délibérément dans `V15`.

## Vérification

```bash
bash scripts/schema/verify-lot0.sh /chemin/vers/flow-bright-desk_261109.backup
```

Attendu : `LOT 0 : CRITÈRE DE SORTIE ATTEINT` — parité de 2 885 lignes de
manifeste, zéro écart, recette d'isolation verte.

## Modèle de sécurité à respecter par l'API

Les 105 tables ne sont **pas** en `FORCE ROW LEVEL SECURITY` : le propriétaire
des tables contourne les 157 politiques. L'API doit donc :

1. se connecter avec `qerp_api` (non propriétaire, `NOBYPASSRLS`, membre de
   `authenticated`) ;
2. à chaque transaction : `SET LOCAL request.jwt.claims = '{"sub":...,"role":"authenticated"}'`
   — `SET LOCAL`, jamais `SET`, pour que le contexte ne survive pas à la
   transaction sur une connexion mutualisée ;
3. ne jamais utiliser `service_role` sur le chemin de requête d'un utilisateur.

Sans contexte, `auth.uid()` vaut `NULL`, donc aucune ligne n'est lue ni écrite :
l'échec est fermé. C'est prouvé par
`src/test/resources/fixtures/rls-isolation-test.sql`.