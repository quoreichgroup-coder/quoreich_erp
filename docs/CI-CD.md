# CI/CD QUOREICH

Chaîne d'intégration et de livraison continues (26 nov. 2026). Décisions de référence : DIR-01 (protection de `main`),
DIR-02 (pilote sur un projet Supabase dédié, recette séparée, RPO 15 min / RTO 4 h), mémoire « déploiement Supabase
manuel » (la production reste à la demande).

## 1. Vue d'ensemble

```
PR ──► CI (client web, E2E simulés, API Java + 299 tests d'intégration, image)   ← obligatoire pour fusionner
          │ verte sur main
          ├──► Livraison : image ghcr.io/<propriétaire>/qerp-api:main et :sha-<commit>
          └──► Déploiement Supabase : projet de RECETTE (automatique)
Chaque nuit ──► Parcours métier sur la RECETTE (main validé, pas de rapport connecté publié)
À la demande ──► Déploiement Supabase PRODUCTION (validation d'une personne désignée)
             ──► Déploiement des fonctions edge (recette ou production)
Étiquette vX.Y.Z (commit déjà vert) ──► Version : image vX.Y.Z + latest, front nuage, contrat OpenAPI,
                                         migrations, empreintes SHA-256, version GitHub
```

| Workflow | Déclencheur | Ce qu'il fait |
|---|---|---|
| `ci.yml` | PR, poussée sur `main` | Lint, types, Vitest, contrat API, migrations jumelles, construction, failles critiques npm ; E2E simulés (Playwright, aucun secret) ; `mvnw verify` ; image non root |
| `livraison.yml` | CI verte sur `main` ; étiquette `v*.*.*` | Publication de l'image ; version complète sur étiquette (refusée si la CI n'a pas réussi sur ce commit) |
| `deploy-supabase.yml` | CI verte sur `main` (recette) ; à la demande (recette ou production) | Migrations absentes appliquées avec registre et empreintes ; simulation par défaut à la demande |
| `deploy-fonctions.yml` | À la demande | Fonctions edge choisies, CLI Supabase épinglé |
| `parcours-nocturnes.yml` | Chaque nuit, à la demande | Parcours Playwright connectés sur la recette ; rapport conservé 14 jours |
| `dependabot.yml` | Chaque semaine | Mises à jour npm, Maven, actions, Docker |

## 2. Le front se construit par environnement

Vite écrit les variables `VITE_*` dans le code au moment de la construction. Il n'existe donc pas de paquet front
universel :
- **nuage** : construit par `livraison.yml` avec les variables de l'environnement `supabase-production` ;
- **sur site** : construit à l'installation avec l'adresse de l'API du client :
  `VITE_QERP_API_URL=https://erp.client.example npm run build`.

## 3. Mise en place (une fois, par un administrateur du dépôt)

### Environnements GitHub (Settings → Environments)

| Environnement | Protection | Secrets | Variables |
|---|---|---|---|
| `supabase-staging` | aucune | `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `E2E_EMAIL`, `E2E_PASSWORD`, `E2E_APPROVER_EMAIL`, `E2E_APPROVER_PASSWORD` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` |
| `supabase-production` | **Required reviewers** (le propriétaire), branche `main` et étiquettes `v*` seulement | `SUPABASE_DB_URL`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` |

- `SUPABASE_DB_URL` : chaîne **du pooler** (`aws-…pooler.supabase.com`, port 6543 ou 5432), rôle postgres ; l'hôte
  direct `db.<ref>.supabase.co` est IPv6 seulement, inaccessible aux exécutants GitHub.
- Clés **publiables** seulement dans les variables `VITE_*` ; jamais de clé `service_role`.

### Projet de recette (DIR-02)

1. Créer un projet Supabase « QUOREICH recette » (même région que la production).
2. Appliquer le socle puis les migrations : lancer « Déploiement Supabase » à la demande, cible `staging`,
   `dry_run` décoché (voir la procédure de reprise du 13 nov. dans `CLAUDE.md` pour le socle V3–V15).
3. Créer les deux comptes de test (`scripts/e2e/compte-de-test.sql`, approbateur) et renseigner leurs secrets.

### Protection de `main`

Fusion seulement par PR, jobs « Client web », « E2E simulés », « API Java » et « Image de l'API » obligatoires.

## 4. Publier une version

```bash
git checkout main && git pull
git tag -a v1.0.0 -m "QUOREICH 1.0.0" && git push origin v1.0.0
```
Puis, si la version contient des migrations : « Déploiement Supabase » → production (simulation, puis application
après validation).

## 5. Limites connues

- Pas de déploiement automatique du front (hébergement de production non choisi) ni de l'API sur VPS (backlog B-04) :
  les paquets de version sont prêts à être consommés par ces cibles.
- Sauvegarde / restauration (B-01) hors de cette chaîne.
- La parité avec le dump de production (`verify-lot0.sh`) reste une vérification locale (données personnelles).

## 6. Sécurité CI/CD — Phase 01 (D-CICD-001)

Rapport : [audit de sécurité](security/QERP_CICD_SECURITY_AUDIT.md),
[registre de remédiation](security/QERP_CICD_REMEDIATION_REGISTER.md),
[décisions](security/QERP_CICD_DECISION_REGISTER.md).

Les workflows privilégiés passent d'abord par `authorize.yml`, sans environnement ni secret, avec
`contents: read` et `actions: read`. La politique est récupérée depuis `main` (checkout sparse).
Elle vérifie l'identité du dépôt QERP (nom et ID), le workflow CI exact, son événement `push`, la branche
`main`, le SHA et les quatre jobs réussis de la tentative courante. Aucun artefact CI n'est téléchargé.
Les jobs suivants récupèrent seulement le SHA autorisé, avec `persist-credentials: false`.

Un `workflow_run` de PR, de fork (même si la branche s'appelle `main`), de CI manuelle ou en échec
ne peut pas autoriser la livraison. Le commit automatique doit encore être la tête de `main`.
Les lancements manuels doivent sélectionner `main` et sa tête actuelle, validée par une CI `push/main`.
L'acteur initial et l'acteur d'une relance doivent conserver le droit write, maintain ou admin.

Les versions exigent une étiquette stricte `vX.Y.Z`, résolue au SHA exact (étiquette annotée comprise),
un commit contenu dans l'historique de `main`, les quatre contrôles de CI push/main et les droits
maintain/admin des deux acteurs. Le propriétaire doit protéger la création, la modification et la suppression
des étiquettes `v*` avec un ruleset distinct. Les contrôles dans le YAML ne sécurisent pas un ancien
workflow choisi par une étiquette historique.

Avant tout accès à un environnement, le contrôleur exige des politiques de déploiement explicites :
staging = branche `main` seulement ; production = `main`, plus étiquettes `v*` pour les versions.
La production exige aussi des reviewers, l'interdiction de s'approuver soi-même et aucun contournement
administrateur. La simulation manuelle reste activée par défaut et exige les mêmes protections.
Attention : le script existant initialise le registre SQL même en dry-run ; ce mode n'est pas une
lecture seule de la base.

**État observé le 26/11/2026 :** staging existe sans restrictions ; production n'existe pas ; aucun
ruleset de tags n'est présent. Les workflows corrigés refusent ces configurations incomplètes.
Leurs réglages et les secrets restent à la charge du propriétaire et n'ont pas été modifiés par cette PR.
Ne pas utiliser un lancement de production pour valider cette remédiation.

Le ruleset existant de `main` (28181257) conserve les quatre contrôles obligatoires. Il exige une PR
mais son nombre d'approbations requis est actuellement 0 : l'approbation humaine explicite demandée
pour cette remédiation est donc une condition supplémentaire avant fusion.

GHCR conserve `ghcr.io/<propriétaire>/qerp-api`, `main`, `sha-<12 caractères>`, `vX.Y.Z` et
`latest`. La construction et le test non-root précèdent la connexion au registre ; le jeton n'est
passé qu'à l'étape de publication, puis Docker se déconnecte. Les caches npm/Maven restent dans la CI
sans secrets ; aucun cache n'est restauré dans les jobs privilégiés. Les rapports des parcours connectés
ne sont plus téléversés, car ils peuvent inclure des sessions ou données métier.

Validation locale : `npm ci --ignore-scripts`, `npm run security:check`,
`actionlint -shellcheck= -pyflakes=`. Les options d'actionlint désactivent seulement les intégrations
aux outils externes absents sur ce poste ; l'analyse YAML et des expressions reste active.
Le registre contient les résultats locaux et les quatre résultats CI du SHA final de PR.
Les hooks locaux sont des protections complémentaires : leurs rappels à usage unique ne valent jamais
autorisation humaine, et aucun hook n'a été désactivé.

Une relance partielle ne réutilise pas une autorisation antérieure : la tentative doit correspondre à celle du job.
Pour récupérer après un échec, relancer tous les jobs ou le job d'autorisation avec ses dépendants.
Les groupes de concurrence s'appliquent après autorisation. Les étapes de publication revalident le SHA du tag
après l'approbation et avant les écritures ; les protections d'étiquettes restent indispensables.
