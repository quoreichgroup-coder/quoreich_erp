# G-32 — Relances clients exécutées — Plan d’implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à une personne habilitée d’apercevoir et d’envoyer manuellement la prochaine relance client par courriel, avec un historique idempotent.
**Architecture:** PostgreSQL calcule la prochaine règle et fige un événement protégé par une clé unique; l’API Java envoie le texte brut via SMTP configuré par environnement; une interface AR fait confirmer l’action et affiche l’historique.
**Tech Stack:** PostgreSQL V142, Spring Boot 4 / Jakarta Mail, React Query, Playwright; aucun secret SMTP persisté.
**Spec:** `docs/audit-erp/31-relances-clients-executees.md`.

## Global Constraints

- La facture doit être émise et conserver un solde positif; l’échéance et le seuil `days_overdue` doivent être atteints.
- Une seule prochaine règle courriel par facture; lettres et appels ne sont pas envoyés par cette tranche.
- Le courriel est du texte brut, sans HTML, pièce jointe ou expression; les jetons permis sont listés dans la spécification.
- Courriel/destinataire/message sont figés avant envoi; clé unique société + facture + règle empêche les doubles clics et reprises HTTP.
- Aucun frais, intérêt, état de facture ou écriture comptable n’est modifié.
- SMTP est facultatif mais doit être entièrement configuré avant création de l’événement; aucun secret en base ou client.
- Droit `ar.invoice` pour aperçu/envoi, `ar.settings` pour gérer les règles.
- Conserver les changements V140/V141 et la recette Gotenberg existante.

## Review Focus

- Deux demandes concurrentes sur la même facture/règle → un seul événement et un seul envoi.
- Échéance, seuil et solde à la frontière → éligibilité calculée en dates/numériques PostgreSQL.
- Facture d’une autre société ou lecteur → refus sans fuite de détails.
- SMTP non configuré, erreur ou réponse incertaine → message d’état explicite et aucune reprise automatique.
- Jeton inconnu, injection de ligne d’en-tête ou HTML dans les champs client → texte inerte, destinataire validé.

---

### Task 1: Schéma et décisions d’éligibilité PostgreSQL

**Files:** V142 Flyway + jumelle Supabase, `SchemaMigrationIT.java`, nouveau `ArDunningIT.java`.
**Interfaces:** `ar_dunning_candidates()` retourne les prochaines relances visibles; `prepare_ar_dunning_event(invoice, rule)` fige une relance unique; `claim_ar_dunning_event(id)` la réserve; `finish_ar_dunning_event(id, outcome, error)` clôt le traitement par le serveur.

- [ ] Écrire les tests d’isolation, permissions, facture soldée/non échue, règle lettre exclue, niveau suivant et concurrence.
- [ ] Exécuter les tests et observer l’échec avant V142.
- [x] Créer `ar_dunning_events` et les fonctions/contraintes RLS : unicité (tenant, facture, règle), journal immuable, contenu/destinataire figés, droits appelants et rôles API serveur.
- [ ] Exécuter `ArDunningIT` et `SchemaMigrationIT`; vérifier les jumelles V142.

### Task 2: Envoi SMTP et routes Java

**Files:** `services/api/pom.xml`, configuration applicative, `modules/receivable/ArDunning*`, tests Java SMTP.
**Interfaces:** GET `/api/v1/ar/dunning/candidates`; GET `/api/v1/ar/dunning/history`; POST `/api/v1/ar/dunning/{invoiceId}/send` `{rule_id}`. Configuration `QERP_SMTP_HOST`, `QERP_SMTP_PORT`, `QERP_SMTP_USERNAME`, `QERP_SMTP_PASSWORD`, `QERP_SMTP_FROM`, `QERP_SMTP_STARTTLS`.

- [ ] Écrire les tests du format texte, SMTP désactivé, adresse destinataire invalide et statut d’acceptation.
- [ ] Vérifier le rouge; ajouter le starter mail officiel Boot et le client SMTP; borner le délai et ne jamais réessayer automatiquement.
- [x] Ajouter les routes API, réserver puis journaliser l’envoi via les RPC; message SMTP en texte brut; réponse incertaine non rejouable.
- [ ] Vérifier les tests Java ciblés et les paramètres SMTP sans configuration réelle.

### Task 3: Écran de contrôle AR

**Files:** hook AR, composant `ARDunningPanel`, `ARControl.tsx` et tests Vitest.
- [ ] Écrire tests du tableau, du refus si SMTP absent, de la confirmation, de l’envoi et de l’historique.
- [x] Créer l’onglet « Relances clients » dans Contrôle AR : jours, facture/client, solde/devise, destinataire, aperçu texte et bouton explicite.
- [x] Ajouter confirmation, états SMTP, erreurs et prévention de double clic; cache tenant-scopé, `retry: false`.
- [x] Passer `tsc --noEmit` et build Vite; lint ciblé sans erreur (3 avertissements dans ARControl).

### Task 4: Recette et documentation

**Files:** OpenAPI, parcours Playwright sur site, audit ERP et CLAUDE.
- [ ] Générer/contrôler OpenAPI et types TypeScript.
- [ ] Utiliser un serveur SMTP local temporaire de test; vérifier réception réelle et anti-doublon.
- [ ] Vérifier `ArDunningIT`, échec/destinataire invalide/lecteur/isolation; lint et build faits, migrations jumelles synchronisées.
- [x] Mettre à jour l’audit sans annoncer planification, SMS ou déploiement cloud.
