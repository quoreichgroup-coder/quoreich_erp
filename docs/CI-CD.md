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
Chaque nuit ──► Parcours métier sur la RECETTE
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
