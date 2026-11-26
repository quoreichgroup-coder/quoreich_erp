# Lot 6 D1 — modèles et factures clients archivées

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publier des modèles versionnés et réimprimer le PDF conservé d'une facture client émise.
**Architecture:** Présentation structurée validée en PostgreSQL, HTML généré et échappé côté serveur. Même contrat RPC
pour l'API Java et la fonction Supabase. Gotenberg isolé réalise la conversion hors du traitement HTTP ; archive immuable.
**Tech Stack:** PostgreSQL, React, Java 25, Supabase Edge Functions, Gotenberg 9.2 ; aucune bibliothèque applicative ajoutée.
**Spec:** `docs/audit-erp/30-documents-modeles-et-archives.md` ; cahier v1.1 §24 et DEC-06.

## Global Constraints

- Première tranche `ar_invoice` seulement ; ne pas annoncer la fin du lot 6 complet.
- Conserver les modifications V140 existantes ; ne pas modifier une migration déjà déployée.
- V141 Flyway et jumelle Supabase au SQL identique ; installer les gardes d'isolation des nouvelles FK.
- Modèle publié et édition prête immuables. Aucun moteur d'expression ni HTML libre ; texte échappé côté serveur.
- Droit `reports.templates` pour modèles, `ar.invoice` pour émission ; lecture dans la société de l'appelant.
- Reprendre l'archive existante par défaut ; remplacement explicite motivé ; montants en devise figés depuis la facture.
- Aucune publication de code ni mise en production de nouveau service sans destination déjà autorisée et configurée.
- Travailler dans le checkout courant, branche Codex existante ; l'utilisateur a demandé de poursuivre sans questions de procédure.

## Review Focus

Courses de double émission ; changement du modèle/tiers après émission ; contenu malveillant et URL ; panne après dépôt
avant validation ; fichier existant altéré ; travail asynchrone qui perd le contexte société ; facture en devise.

## Contrat commun

`document_templates`: id, tenant_id, doc_type='ar_invoice', name, current_version_id, created_at, created_by.
`document_template_versions`: id, tenant_id, template_id, version_no, layout, content_html, sha256, created_at,
created_by, reason, published_at, published_by. `layout`: title, intro, footer (texte), accent_color (#RRGGBB), font_size (8..14).
`issued_documents`: id, tenant_id, ar_invoice_id, template_version_id, context (JSON), context_sha256, reference,
status, storage_path, pdf_sha256, renderer, renderer_version, created_by, created_at, started_at, finished_at,
error, replaces_id, replacement_reason.

RPC :
- `save_document_template(_id uuid, _name text, _layout jsonb, _reason text)` → JSON `{template,version}` ; id NULL crée.
- `publish_document_template(_version uuid, _reason text)` → JSON version publiée.
- `request_document_edition(_invoice uuid, _template uuid DEFAULT NULL, _replace uuid DEFAULT NULL, _reason text DEFAULT NULL)` → JSON édition.
- `retry_document_edition(_id uuid)` → JSON édition ; échec ou travail expiré > 60 s, même instantané.
- `claim_document_edition(_id uuid, _actor uuid)` → JSON ou NULL ; JSON édition + `html` et `storage_path`.
- `complete_document_edition(_id uuid, _actor uuid, _path text, _sha256 text, _renderer text, _renderer_version text)` → JSON édition.
- `fail_document_edition(_id uuid, _actor uuid, _error text)` → JSON édition.
Les trois dernières sont réservées aux rôles serveur. Chemin canonique `<tenant>/issued/<id>.pdf`.

HTTP Java : GET/POST `/api/v1/document-templates`; POST `/api/v1/document-templates/{version}/publish` `{reason}`;
GET `/api/v1/document-editions?invoiceId=…`; POST `/api/v1/document-editions` `{invoice_id,template_id?,replace_id?,reason?}`;
POST `/api/v1/document-editions/{id}/retry`; GET `/api/v1/document-editions/{id}/download`.
POST retourne l'édition immédiatement, travail asynchrone ensuite. Nuage : même corps à `document-render`, avec `id` pour relance.

### Task 1: Données, preuves, nuage et audit — parent

**Files:** V141 et jumelle ; `ArticlesDocumentsIT` (nom final `DocumentsArchivesIT.java`), `SchemaMigrationIT.java`,
`scripts/schema/supabase-platform.sql`, `supabase/functions/document-render/`, docs audit 28/30.
**Interfaces:** produit le contrat RPC ci-dessus ; consomme les factures et lignes V125, règles de tenant et droits existants.
- [x] Écrire et observer les tests PostgreSQL de permissions, version immuable, contexte/devises, idempotence/remplacement et refus d'écritures directes.
- [x] Implémenter V141, HTML généré avec jetons autorisés et échappement ; aucun HTML fourni par le navigateur.
- [x] Ajouter le compartiment privé `issued-documents` (lecture enregistrée seulement, aucune écriture utilisateur).
- [x] Ajouter la fonction nuage : utilisateur vérifié, RPC utilisateur puis RPC serveur, délai borné, dépôt sans écrasement, empreinte et reprise d'un dépôt orphelin.
- [x] Vérifier les jumelles, la reconstruction du schéma et la recette ciblée.

### Task 2: API Java, rendu isolé et fichiers — implementer renderer

**Files:** nouveaux fichiers du paquet `modules/documents` (ne pas modifier AttachmentsController), tests associés,
`infra/pdf/`, configuration PDF dans application.yml ; pas de modification des migrations, du frontend ou du contrat OpenAPI généré.
**Interfaces:** consomme exactement les RPC et endpoints ci-dessus. Rendu configuré par `qerp.pdf.url` / `QERP_PDF_URL`,
version `qerp.pdf.renderer-version` défaut `9.2`, racine `qerp.files.dir` existante ; HTTP renderer configurable en tests.
- [x] Lire les motifs `platform.Sql`, `AttachmentsController` et ses tests ; créer des tests avant le code.
- [x] Ajouter Query/Service/Controller : aucun accès DataSource/JdbcTemplate dans Controller ; contexte utilisateur capturé pour le travail asynchrone et réinstallé dans son thread.
- [x] Executor 1 travail, file 20, erreur enregistrée si saturée. HTTP rendu ≤ 30 s, PDF ≤ 25 Mo, vérification signature `%PDF-`, SHA-256.
- [x] Gotenberg reçoit uniquement HTML sûr issu du RPC ; stockage à création exclusive, jamais écrasé ; une reprise réutilise le fichier orphelin du même travail et son empreinte.
- [x] Télécharger uniquement une édition `ready` visible via RLS ; vérifier l'empreinte avant de servir, chemin résolu dans la racine, pas de symlinks.
- [x] Fournir Dockerfile/compose Gotenberg 9.2 avec polices Montserrat/Playfair et licences ; réseau interne, pas de sortie, JS désactivé, téléchargements désactivés, limites.
- [x] Tester le client HTTP, les fichiers et l'empreinte, exécuter les tests unitaires ciblés et raccorder l'API au réseau interne par Compose. Parcours API → Gotenberg → archive → réimpression/remplacement passé localement.

### Task 3: Éditeur et archives dans les écrans — implementer frontend

**Files:** `src/hooks/use-document-editions.ts`, `src/components/DocumentTemplatesPanel.tsx`,
`src/components/DocumentEditions.tsx`, tests ; `Settings.tsx`, `ARTransactions.tsx` seulement aux points d'intégration.
**Interfaces:** consomme le contrat ci-dessus ; `DocumentEditions({invoiceId:string,canIssue:boolean})`.
- [x] Tests avant code : publication réservée au droit, sauvegarde/publier avec motif, affichage d'une archive prête et erreur avec reprise explicite.
- [x] Hooks tenant-scopés, retry:false. API Java si activée ; sinon tables/RPC Supabase et `functions.invoke('document-render')`.
- [x] Liste des modèles avec versions, création/édition structurée ; aperçu de `content_html` dans iframe sandbox sans scripts, jamais de HTML libre.
- [x] Onglet Paramètres « Modèles de documents », droit `reports.templates`. Motifs obligatoires, boutons du design system, focus des dialogues restauré à leur initiateur.
- [x] Vue de facture émise : bloc « Éditions archivées », création, remplacement motivé, statut, erreur, relance ; téléchargements vérifiés, polling borné et cache par tenant/facture.
- [x] Conserver l'impression locale existante ; aucun PDF de démonstration dans le produit.
- [x] Tests Vitest ciblés et contrôle des types ; 17 tests ciblés passent.

### Task 4: Intégration et recette — parent

- [ ] Relecture indépendante de chaque livrable puis de l'ensemble ; corriger problèmes importants.
- [x] Recetter l'API Java avec Gotenberg, PDF → archive → réimpression après changement de modèle ; octets originaux identiques, nouvelle version différente, PDF/A-2b.
- [x] Ajouter/jouer le parcours 107. Tests Java ciblés, tests Vitest ciblés (17), types, lint, build, contrat OpenAPI et jumelles sont passés. Suite Vitest complète non relancée.
- [x] Mettre à jour l'audit et le suivi avec preuves et limites ; aucune affirmation de déploiement nuage sans hôte de rendu réel.
