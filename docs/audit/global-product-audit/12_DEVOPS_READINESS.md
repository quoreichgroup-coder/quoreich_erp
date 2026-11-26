# 12 — Préparation DevOps et exploitation

> Phase 5. Question de la demande : « une instance client peut-elle être installée, configurée, sauvegardée, mise à jour
> et restaurée de manière reproductible ? » — **Réponse : pas encore.** Installation et mise à jour du schéma oui ;
> exploitation de production, sauvegarde et restauration non.

## 1. Constat

| Élément | État | Preuve |
|---|---|---|
| Environnements | Développement (poste) ; nuage Supabase unique servant de production **et** de test (société E2E) ; **ni recette ni préproduction** | EV-25 |
| VPS, Caddy, DNS / Cloudflare, TLS | **Absents** du dépôt ; lot 1 « premier déploiement VPS » non fait | EV-14, EV-25 |
| Image API | Multi-étapes, JRE 25, utilisateur non root (vérifié en CI), `HEALTHCHECK` | `services/api/Dockerfile`, job « Image de l'API » |
| Compose | Développement seulement (`infra/compose.dev.yml`, Gotenberg `infra/pdf`) ; **pas de compose de production** | EV-25 |
| Migrations | Flyway au démarrage (sur site) ; script de déploiement nuage avec registre et empreintes ; jumelles contrôlées | `scripts/schema/deploy-supabase.sh` |
| CI/CD | CI complète (3 jobs) ; déploiement nuage manuel ; **pas de déploiement continu sur site** ; pas de protection de branche | `.github/workflows/` |
| Rollback | Migrations « en avant » seulement ; pas de procédure de retour arrière documentée | — |
| Sauvegardes / restauration | **Aucun script, aucune planification, aucun test** ; le seul « restore » scripté sert à la vérification du socle | EV-25 |
| Supervision | Actuator (`health`, `metrics`, `prometheus`) exposés ; **aucun collecteur, tableau de bord ni alerte** | `application.yml` |
| Journaux | Journal applicatif + `qerp_identity.events` + audit métier en base ; pas de centralisation | — |
| RPO / RTO, PRA | DEC-08 **ouverte** | EV-09 |
| Clé de signature des jetons (sur site) | Créée au premier démarrage dans un fichier local ; sa sauvegarde comme secret n'est pas organisée | CLAUDE.md |
| Fonctions nuage non déployées | `document-render`, `ar-dunning` (+ secrets SMTP, hôte Gotenberg public) | EV-14 |
| Hébergement du front | Encore sur Lovable ; bascule vers un hébergement propre non faite | CLAUDE.md |

## 2. Travaux bloquants avant un pilote

1. Choisir la cible du pilote (nuage Supabase dédié ou VPS sur site) et créer **un environnement de recette séparé** de la production.
2. VPS : compose de production (PostgreSQL, API, Gotenberg, front statique), Caddy (TLS automatique), pare-feu, utilisateur
   de migration `qerp_migrate` (n'existe pas encore).
3. Sauvegardes : `pg_dump` / archivage WAL chiffrés hors site + fichiers (`qerp.files.dir`, clé de signature) ; **restauration
   testée et chronométrée**, puis fixer RPO / RTO (DEC-08).
4. Supervision : Prometheus + alertes (santé, erreurs 5xx, connexions, espace disque, verrouillages de comptes).
5. Procédure de mise à jour et de retour arrière (sauvegarde avant migration, version d'image figée).
6. Protection de branche : fusion vers `main` uniquement si la CI est verte.

**Statut infrastructure : 1 / 5 (structure initiale).**
