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

`V80__paie_par_pays_et_baremes_configurables.sql` ajoute la configuration
progressive des barèmes de paie par société (pays, devise, tranches, plafonds),
leur confirmation explicite, la photographie des règles par cycle et les
cotisations patronales par salarié. La génération fige aussi le département
du salarié dans chaque ligne pour que les rapports historiques ne changent pas
après une modification ultérieure de son dossier ; les anciennes lignes sans
photographie sont signalées comme affectation historique inconnue.
Aucun taux légal n'est fourni par la migration ; les valeurs sont à saisir et
à vérifier à partir des sources officielles applicables.

`V81__acces_rh_et_api_paie.sql` centralise les droits RH de consultation,
remunération et coordonnees bancaires. Il expose l'annuaire par fonction
securisee avec salaire et compte bancaire masques hors droit sensible, et
verrouille l'ecriture directe sur `employees`. L'API `/api/v1/hr` applique
le tenant du jeton pour le mode on-premise.

`V82__mouvements_rh_effectifs_et_audit.sql` ajoute les mouvements RH datés,
les décisions par un approbateur distinct, la piste d'audit immuable et le
calcul de l'état salarié à la date de paie. Le motif et le type sont saisis
par société ; aucun motif réglementaire ou valeur métier n'est injecté.

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

### V83 - Référentiels de mouvements RH
- V83__referentiels_mouvements_rh_configurables.sql a pour jumelle supabase/migrations/20261115320000_5fa1c694-e1e1-47cb-b197-04f3d4b5c54a.sql.
- Types et motifs sont créés par société sous Paramètres RH; aucun référentiel légal n'est prérempli.

### V84 - Rubriques de paie paramétrables
- V84__rubriques_de_paie_configurables.sql a pour jumelle supabase/migrations/20261115330000_62b08f1e-6049-4bf9-85fd-913762285c3b.sql.
- Le catalogue des rubriques est propre à la société et accessible par API/RPC sous le droit central `hr.manage_payroll_components`.
- Les gains, retenues et charges, montants/méthodes, dates d'effet, plafonds, compte comptable et ordre sont administrables; aucune ligne opérationnelle n'est préchargée.
- La saisie des affectations individuelles et l'intégration des rubriques au calcul restent à livrer avant de considérer la paie complète.

### V85-V87 - Affectation, variables et photographie des rubriques
- V85 ajoute les affectations effectives-datées des rubriques aux salariés et interdit les chevauchements.
- V86 ajoute la saisie idempotente des variables par référence, l'approbation distincte, le blocage du calcul tant qu'une variable reste en attente, et les lignes détaillées photographiées.
- Le calcul distingue les gains, retenues et charges; les bases fiscales/sociales sont des options explicites par rubrique, sans taux ni traitements juridiques préremplis.
- V87 expose ces traitements dans le référentiel et réserve le détail du bulletin au droit `view_sensitive`.
- Jumelles : V85 `20261115340000_8507e6b2-99ee-4ca9-bf9f-5cd5bb55de4a.sql`, V86 `20261115350000_caa6ab9e-2b42-4f34-94fb-75ef2d45267a.sql`, V87 `20261115360000_43af6091-e4dc-49a7-a4e6-b911b15da359.sql`.
- V88 `20261115370000_ee35e29a-a8f2-4a25-825c-b3df3d19167a.sql` expose la valeur de remplacement brute pour qu'une modification d'affectation ne transforme pas implicitement la règle source en valeur personnalisée.

### V89 - PrÃ©contrÃ´le et sÃ©paration des fonctions Paie
- V89__precontrole_et_separation_des_fonctions_paie.sql est jumelÃ©e Ã  supabase/migrations/20261115380000_13d700b1-c69e-4b91-99e7-e5d1e747a18a.sql.
- L'approbation exige le dernier prÃ©contrÃ´le valide aprÃ¨s le calcul et applique la sÃ©paration entre prÃ©parateur et approbateur.

### V92 - Isolation après ajout des tables RH, Paie et inventaire
- V92 réinstalle les déclencheurs de contrôle de clés tenant après V81-V91 et vérifie les références des nouvelles tables.
- Jumelle : supabase/migrations/20261115410000_bbceeb31-34e9-4005-9531-89c4d36d84b2.sql.
- Les cycles de paie précontrôlés ne peuvent pas être supprimés physiquement : leur piste de contrôle immuable reste rattachée au cycle.
- Vérification : 76 paires V16-V92, contenu et ordre identiques.

### V93-V98 - Contrôles inventaire et clôture des améliorations Paie/RH
- V93 et V94 renforcent le contrôle des campagnes d'inventaire, leur catalogue et la saisie groupée; V96 ajoute la planification tournante ABC.
- V95 ajoute l'import des matricules et les actions groupées RH, avec les réglages de numérotation centralisés par société.
- V97 rejette les tranches fiscales absentes, nulles ou mal formées avant confirmation des règles de paie.
- V98 poste les gains, retenues et charges employeur sur les comptes actifs photographiés par rubrique, et utilise les rôles configurés en repli. Le précontrôle bloque une rubrique dont le compte a été désactivé ou n'est plus imputable.
- V99 photographie le rang `sort_order` des rubriques de paie lors du calcul, pour rééditer le bulletin selon l'ordre en vigueur à cette date.
- Jumelles : V93 `20261115420000_c470d9a5-409c-4246-b594-7c228a987fea.sql`, V94 `20261115430000_20c05e95-2d4c-4e77-8c80-ab54c9ed567f.sql`, V95 `20261115440000_a7fa3916-c342-47ed-8f88-16e5ddb20ca0.sql`, V96 `20261115450000_72ed34d1-7476-4f97-8092-b7d07749fe6c.sql`, V97 `20261116060000_17ea260b-14de-4fc7-93ac-d3c7731f19d5.sql`, V98 `20261116070000_5c598d4d-65b5-4525-bdc4-764de3eb5676.sql`, V99 `20261116200000_2aca6dff-cbc8-4609-b7b5-4c527d212569.sql`.
- La synchronisation des fichiers jumelés est vérifiée par `npm run db:check-twins`.

### V100 — Stock global restant à affecter
- Un écart positif d’inventaire ne peut plus augmenter le solde global si celui-ci dépasse déjà le total des quantités enregistrées par dépôt pour l’article. Le refus annule toute la validation ; le comptage reste soumis et le dépôt reste gelé.
- Jumelle : `20261117062700_45e17c65-97eb-459a-8375-64091e524d42.sql`.
