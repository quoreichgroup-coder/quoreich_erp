# Personnalisation des accès des rôles

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Permettre à l'administrateur de modifier les droits de tous les rôles de sa société, sauf Administrateur.

**Architecture:** Conserver les identités des rôles standard et les affectations. Remplacer atomiquement leurs permissions par une fonction commune aux chemins API et Supabase, protégée par la société courante et le rôle administrateur. Ne plus réinitialiser les permissions des rôles existants lors de leur initialisation.

**Tech Stack:** React, TanStack Query, Spring Boot, PostgreSQL/Flyway et Supabase.

**Spec:** Demande utilisateur du 21 novembre 2026 ; groupes de sécurité modifiables par tâche dans la documentation officielle Sage 300 2026.

## Contraintes

- Administrateur protégé dans l'écran, l'API et les écritures directes en base.
- Métadonnées et suppression des rôles standard toujours protégées ; seuls leurs accès deviennent personnalisables.
- Droits cumulés des rôles affectés, journal existant conservé, isolation par société.
- Aucun changement automatique des droits actuels ni des comptes utilisateur.
- Préserver les modifications existantes du dépôt et la clé d'identité du serveur local.

## Vérifications ciblées

- [x] Tests rouges : Comptable modifiable, Administrateur verrouillé, utilisateurs non administrateurs en lecture seule.
- [x] Migration jumelle : garde, remplacement atomique, validation et initialisation sans restauration des droits retirés.
- [x] API et hook Supabase utilisent la même opération ; actualisation des accès après enregistrement.
- [x] Tests d'intégration : effet réel, autre société intacte, droits inconnus sans effet partiel, réinitialisation sans rétablissement, refus admin/non-admin.
- [x] Tests de schéma et modules, build, revue indépendante.
- [x] Sauvegarde et activation locale, santé et conservation des droits/clé vérifiées.

## Éléments de validation

- Tests d'écran/hook/catalogue : 48/48 sur huit fichiers ; TopNav et use-my-access avaient également réussi avant les derniers changements limités aux immobilisations et à la garde SQL.
- Autorisations HTTP existantes : 6/6 ; frontière modules : 7/7 ; schéma complet : 7/7.
- Suite Java unitaire : 35 tests, aucun échec, un test d'archive déjà désactivé.
- Nouvelle régression SQL : marqueur d'initialisation falsifié refusé ; UPDATE de permission interdit afin de préserver le journal INSERT/DELETE.
- RolePermissionsIT : 5/5 après correction d'une dépendance à l'ordre des données de test ; `services/api/.tmp-role-permissions-verified.log` termine par BUILD SUCCESS.
- Revue indépendante : les trois points signalés (marqueur, audit UPDATE, boutons immobilisations) sont corrigés ; aucun autre défaut important identifié.
- Compilation Vite et cohérence OpenAPI validées ; 131 paires de migrations identiques V16–V147 ; lint sans erreur.
- Les trois erreurs TypeScript préexistantes SMTP/PDF observées pendant ce correctif ont ensuite été corrigées dans `2026-11-21-role-permissions-follow-up.md` : contrôle complet désormais réussi et 719 tests frontend validés.
- Sauvegarde avant activation : `C:/Users/Abdouramane/QERP-backups/qerp_reel_pre_role_permissions_20261121.backup` ; ancien programme et empreintes dans `output/role-permissions-runtime/`.
- Activation métier : `qerp-api-lot6` sur le port 8092 utilise `qerp_reel`, contenant les deux comptes. Son programme est monté depuis `services/api/target/qerp-api-0.0.1-SNAPSHOT.jar` ; redémarrage sans recréer le conteneur. Clé d'identité conservée ; empreintes des rôles, permissions et affectations avant/après identiques. Migration 147 appliquée, santé HTTP 200 / UP.
- Adresse de `.env.development.local` et compilation locale alignées sur `http://127.0.0.1:8092`. Vite sur 8081 sert cette adresse après son rechargement automatique. Le service `qerp-dev-api` sur 8093 utilise une autre base, `qerp` ; il a également reçu le programme mais ne contient pas les comptes métier. L'adresse 8093 des vérifications antérieures ne doit plus être utilisée pour valider les comptes métier.

## Référence fonctionnelle

[Sage 300 2026 : ajouter, modifier et supprimer les groupes de sécurité](https://help.sage300.com/en-us/2026/web/Content/AdministrativeServices/Security/AddingModifyingSecurityGroups.htm) : l'administrateur choisit l'application, coche/décoche les tâches et enregistre le groupe. Le verrouillage des permissions du rôle Administrateur dans QERP est la règle demandée par l'utilisateur ; il n'est pas présenté comme une interdiction générale de Sage.
