# 06 — Audit de sécurité et multi-société

> Phase 3. Méthode : lecture du code, requêtes de catalogue en lecture seule (développement et nuage), recherche de
> secrets dans les fichiers suivis, `npm audit`, tests d'isolation existants exécutés en CI. **Aucun test intrusif,
> aucune écriture en production.** Preuves `EV-xx` dans `22_EVIDENCE_REGISTER.md`.

## 1. Synthèse

Le modèle de sécurité est **solide et défendu en profondeur** : la frontière réelle est la base (RLS + déclencheurs +
fonctions contrôlant droit et société), doublée sur site par l'API (contrôle d'accès aux modules, garde de démarrage).
Aucune faille critique constatée. Les écarts sont des durcissements et des manques d'exploitation.

## 2. Contrôles vérifiés

| Domaine | Constat | Preuve |
|---|---|---|
| Isolation des sociétés | RLS sur toutes les tables ; société issue de `profiles`, non modifiable par l'utilisateur (V24) ; FK inter-sociétés refusées (V55) ; fonctions à paramètre société revues (V101) | `IsolationSocietesIT`, `TenantIsolationIT`, `SocieteDuProfilIT`, `ApiSecurityIT` verts en CI (EV-11) |
| Politiques ouvertes | Aucune politique ouverte à `anon` / `public` sans condition d'identité (nuage) ; les 27 politiques `true` sont des lectures de référentiels globaux ou réservées à `service_role` | EV-16, EV-17 |
| Vues | 46 / 46 en `security_invoker` (développement et nuage) | EV-15, EV-16 |
| Fonctions privilégiées | 457 SECURITY DEFINER, toutes avec `search_path` figé | EV-16 |
| Droits | Catalogue de 153 droits, rôles système et personnalisés, séparation des tâches dans la base, refus d'accès aux modules sans droit (V146–V147) | `AuthorizationsApiIT`, `ModuleAccessIT`, `RolePermissionsIT` |
| Secrets | Aucun secret trouvé dans les fichiers suivis (clés Supabase `sbp_`, clés privées, AWS, GitHub, OpenAI, mots de passe) ; `.env`, dumps et clé de signature ignorés | EV-18 |
| Stockage de fichiers (nuage) | 3 compartiments, tous privés ; écriture conditionnée au droit et à la société | EV-16 |
| Identité sur site | ES256, session vérifiée à chaque requête, rafraîchissement à usage unique avec détection de réutilisation, verrouillage après 5 échecs, journal des événements | `IdentityApiIT` |
| Fonctions edge sans `verify_jwt` | Chacune contrôle elle-même : jeton utilisateur (`ar-dunning`, `document-render`, `bceao-rates`), secret partagé (`ai-scheduler`, `bceao-rates`), jeton de 64 caractères dans l'URL (`tracking-webhook`) | EV-19 |

## 3. Écarts et recommandations

| # | Écart | Gravité | Recommandation |
|---|---|---|---|
| S-1 | **49 fonctions SECURITY DEFINER exécutables par `anon`** dans le nuage. 43 contrôlent l'identité ou le droit (refus pour `anon`), mais 2 répondent sans contrôle : `get_user_tenant_id(uuid)` (révèle l'identifiant de société d'un utilisateur dont on connaît l'identifiant) et `analytic_value_scope(uuid)` (liste les identifiants descendants) | Faible (identifiants seulement, aucune donnée métier) | Migration de durcissement : `REVOKE EXECUTE … FROM anon, PUBLIC` sur toutes les fonctions SECURITY DEFINER non destinées aux visiteurs ; test qui échoue si une nouvelle fonction l'est |
| S-2 | Le rôle `anon` du nuage garde les privilèges par défaut de Supabase (écriture sur 180 tables, lecture sur 199) | Faible (la RLS refuse tout à `anon`) | Défense en profondeur : retirer ces privilèges à `anon` sur le schéma `public` |
| S-3 | **Aucune limitation de débit** sur l'API Java (connexion, inscription, webhook, IA) | Moyenne | Limiteur par IP et par compte (proxy inverse ou filtre applicatif) avant exposition sur Internet |
| S-4 | Inscription ouverte (`/auth/v1/signup` public) sur site | Faible | Rendre l'inscription désactivable par configuration (un client sur site invite ses utilisateurs) |
| S-5 | Pas d'en-têtes de sécurité HTTP pour le front (CSP, HSTS, X-Frame-Options) : aucun hébergement de production configuré | Moyenne | À définir avec l'hébergement (proxy inverse) |
| S-6 | Dépendance `zod` vulnérable (GHSA-mrhx-c7xc-m3w5, élevée, épuisement mémoire sur collections surdimensionnées) | Faible dans un navigateur | Montée de version majeure à planifier et tester |
| S-7 | Aucune double authentification (MFA) | Moyenne pour un ERP financier | Ajouter TOTP au moins pour administrateurs et approbateurs |
| S-8 | Effet du contrôle d'accès aux modules : le rôle « Lecteur » ne lit plus les factures clients via l'API sur site | À arbitrer | Confirmer l'intention ; sinon accorder un droit de lecture au rôle (ne pas assouplir l'intercepteur) |
| S-9 | Pas de test d'intrusion externe, pas de revue OWASP formelle, pas de supervision des événements de sécurité | Moyenne | Pentest avant le premier client payant ; alertes sur `qerp_identity.events` (verrouillages, réutilisation de jeton) |
| S-10 | Données réelles (PII) sur le poste de développement | Moyenne | Voir `05_DATABASE_AUDIT.md` D-6 |

## 4. Points à valider avec un spécialiste

- Conformité à la loi burkinabè sur la protection des données personnelles (CIL) : registre des traitements, durées de
  conservation, données de paie.
- Hébergement : localisation des données (Supabase eu-west-1 = Irlande) au regard des attentes des clients.
