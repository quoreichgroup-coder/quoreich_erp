# 26 — Identité sur site (connexion sans Supabase)

État au 19 novembre 2026. Migration V114, module Java `com.quoreich.qerp.identity`, test `IdentityApiIT`, reprise
des comptes `scripts/identite/`.

## 1. Décision (DEC-07)

L'installation sur site ne dépend plus de Supabase pour la connexion : **l'API Java porte l'identité**. Les comptes du
nuage sont **repris tels quels** : même identifiant (les clés étrangères vers `auth.users` restent valides) et même
empreinte de mot de passe (bcrypt), donc chaque utilisateur garde son mot de passe.

| Option | Mots de passe | Composants | Retenue |
|---|---|---|---|
| Keycloak (plan initial) | **réinitialisation de tous les comptes** : Keycloak ne vérifie pas bcrypt sans extension tierce | un serveur de plus (~0,75 Go, mises à jour, sauvegarde) | non |
| Coexistence (Supabase pour la connexion, Java pour les données) | conservés | dépendance au nuage permanente, contraire à la décision « sur site = Java + PostgreSQL » | non |
| **Identité dans l'API** | **conservés** | aucun | **oui** |

L'API parle **le protocole du serveur d'identité de Supabase** (sous-ensemble utilisé par supabase-js) : sur site, le
client Supabase du front est simplement pointé sur l'API (`src/integrations/supabase/client.ts`). Session,
renouvellement automatique, déconnexion, `getUser()` et les écrans de connexion fonctionnent sans changement.

## 2. Fonctionnement

| Route | Rôle |
|---|---|
| `POST /auth/v1/token?grant_type=password` | connexion (adresse, mot de passe) |
| `POST /auth/v1/token?grant_type=refresh_token` | renouvellement (rotation) |
| `POST /auth/v1/signup` | inscription : compte et profil **sans société** ; rattachement par création ou code d'invitation (V31) |
| `GET` / `PUT /auth/v1/user` | compte connecté ; changement de mot de passe (ferme les autres sessions) |
| `POST /auth/v1/logout?scope=local\|global\|others` | déconnexion |
| `POST /auth/v1/recover` | réinitialisation par e-mail : refus explicite tant que la messagerie n'existe pas |
| `POST /api/v1/identity/members/{id}/temporary-password` | mot de passe provisoire fixé par un administrateur de la société pour un membre de **sa** société (affiché une fois, sessions du membre fermées) ; bouton dans Paramètres → Rôles et autorisations → Utilisateurs |

Sécurité (OWASP ASVS V2 / V3, RFC 9700) :
- empreintes bcrypt (coût 10, comme Supabase) ; même temps de réponse pour une adresse inconnue ;
- verrouillage après `max-failed-attempts` échecs (5) pendant `lock-minutes` (15) ; journal `qerp_identity.events`
  (connexion, échec, verrouillage, adresse inconnue, réutilisation, déconnexion, changement de mot de passe) ;
- jeton d'accès ES256 de 60 minutes (durée par défaut de Supabase, sans risque ici puisque la session est vérifiée à chaque requête), mêmes revendications que Supabase (`sub`, `role`, `aud`, `email`, `session_id`) :
  la RLS et les 157 politiques ne voient aucune différence ;
- **chaque requête vérifie que la session est encore ouverte** : une déconnexion, un changement ou une réinitialisation
  de mot de passe prend effet immédiatement, pas à l'expiration du jeton ;
- jeton de renouvellement aléatoire (256 bits), stocké sous forme d'empreinte SHA-256, **à usage unique** ; la
  réutilisation d'un jeton déjà consommé (vol probable) ferme toute la session, sauf dans les 10 secondes qui suivent
  son usage (`refresh-reuse-seconds`, V115 : deux onglets qui renouvellent au même instant, comme Supabase) ;
- schéma `qerp_identity` fermé à tous : RLS sans politique, aucun droit sur les tables, fonctions SECURITY DEFINER
  exécutables par le seul rôle `qerp_api`. Dans le nuage, le schéma existe à l'identique (migrations jumelles) mais
  reste vide, non exposé, et les droits par défaut de Supabase (`anon`, `authenticated`, `service_role`) sont retirés.

Réglages (installation, pas société) : `QERP_IDENTITY_MODE` (`local` par défaut ; `external` = émetteur externe par
`spring.security.oauth2.resourceserver.jwt.*`), `QERP_IDENTITY_ISSUER`, `QERP_IDENTITY_KEY_FILE` (clé de signature
créée au premier démarrage, défaut `./data/identity/signing-key.json` : **à sauvegarder et protéger comme un secret** ;
la perdre déconnecte tout le monde, la divulguer permet de fabriquer des jetons), `QERP_IDENTITY_SIGNUP_ENABLED`,
`qerp.identity.access-token-minutes` (60), `refresh-reuse-seconds` (10), `refresh-token-days`, `max-failed-attempts`, `lock-minutes`,
`password-min-length` (10 ; s'applique aux nouveaux mots de passe, pas aux mots de passe repris).

## 3. Reprise des comptes

```bash
SOURCE_DB_URL=<Supabase, pooler 6543> CIBLE_DB_URL=<sur site, rôle propriétaire> \
  [FILTRE='%@exemple.com'] [APPLIQUER=oui] bash scripts/identite/reprendre-comptes.sh
```

Simulation par défaut. Les empreintes passent d'une base à l'autre par un tube (jamais écrites ni affichées). Un
compte déjà présent avec le même identifiant est mis à jour ; une adresse prise sur site par un autre identifiant est
signalée et non reprise ; les comptes sans empreinte bcrypt (connexion par lien) sont comptés et non repris. Fait le
19 novembre 2026 pour les deux comptes de recette sur `qerp_reel` (2 créés, 0 conflit). Pour une bascule réelle :
lancer la reprise sans filtre juste avant d'ouvrir l'installation, puis à nouveau à la fermeture du nuage (les
changements de mot de passe faits entre-temps sont repris).

## 4. Restes

- Messagerie (SMTP, décision « plus tard ») : réinitialisation par e-mail et confirmation d'adresse. D'ici là, le
  mot de passe provisoire par un administrateur est la voie de secours, et les comptes créés sur site sont
  considérés comme confirmés.
- Double authentification (TOTP) : non disponible ; à prévoir avant une exposition sur Internet.
- Limitation de débit par adresse IP (en plus du verrouillage par compte) : à placer au proxy inverse du VPS.
