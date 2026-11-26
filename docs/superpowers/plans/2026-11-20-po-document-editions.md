# Bons de commande : modèles et éditions archivées

> **For agentic workers:** Use superpowers:executing-plans for the database and integration work; focused parallel work is limited to the independent frontend and Java/Edge adapters below.

**Goal:** Rendre les deux modèles PO demandés sélectionnables dans QERP et conserver les PDF émis avec leurs modèles et données figés.

**Architecture:** Étendre les tables et le circuit V141 aux PO, sans modifier les éditions de factures existantes. Les modèles restent structurés et le HTML est produit par le serveur. Même SQL exécutable dans V143 et sa jumelle Supabase.

**Tech Stack:** PostgreSQL, Java/Spring, React/TypeScript, Supabase Edge, Gotenberg 9.2.

**Spec:** Demande utilisateur « étend aux PO » ; maquettes de travail dans `output/templates/po-standard.html` et `po-reference-PO0004821.html`, référence `docs/TEMPLATES/PO0004821.pdf`.

## Contraintes

- Conserver les modifications préexistantes et les contrats AR. Aucun changement de projet Supabase implicite.
- Droits : `reports.templates` pour les modèles ; `procurement.order` pour émettre/lire les archives PO.
- Isolation par société, instantané exact dans la devise de la pièce, PDF immuable, erreur visible et relance explicite.
- Aucune ressource distante, aucun HTML libre, aucune identité fournisseur ou valeur de la référence codée en dur.
- Créer deux modèles par action idempotente authentifiée de la société courante.

## Contrats communs

- `save_document_template(_id,_name,_layout,_reason)` inchangé ; PO : `_layout.doc_type='purchase_order'`, `_layout.preset='standard'|'reference-PO0004821'`. AR conserve sa présentation existante.
- `install_purchase_order_templates()` → tableau des deux modèles avec `versions`, société courante, droit `reports.templates`, versions publiées.
- `request_purchase_order_edition(_po,_template DEFAULT NULL,_replace DEFAULT NULL,_reason DEFAULT NULL)` → `issued_documents` ; ajout de `po_id`, `ar_invoice_id` nullable et exactement une pièce source.
- API : GET `/api/v1/document-templates?docType=purchase_order`, POST `/api/v1/document-templates/purchase-orders/defaults`, GET `/api/v1/document-editions?poId=…`, POST `/api/v1/document-editions` avec `po_id` au lieu de `invoice_id`. AR sans paramètre supplémentaire reste compatible.
- Téléchargement et relance existants, identifiant de l’édition commun.
- Edge `document-render` accepte exactement une clé parmi `id`, `invoice_id`, `po_id`.

## Vérifications prioritaires

- Aucun lecteur AR ne voit une archive PO sans `procurement.order`, et inversement.
- Une seconde demande reprend la même édition ; remplacement motivé conserve la précédente.
- Version publiée, contexte, devise et octets archivés restent stables après modification du fournisseur ou du modèle.
- Deux installations concurrentes ne créent pas de doublon de modèles.
- Commande brouillon/refusée/annulée et modèles de mauvais type refusés.

## Tâches

- [ ] Données : observer un test SQL en échec, ajouter V143 et jumelle, tester droits, devise, instantané, remplacement, reprise, sécurité HTML et régression AR.
- [ ] Frontend : tests en échec puis sélection du type dans les paramètres, installation des modèles, aperçu et création PO ; bloc d’archives dans les commandes approuvées.
- [ ] Adaptateurs : tests en échec puis API Java et fonction Edge pour les nouveaux contrats ; conserver les anciennes requêtes AR.
- [ ] Intégration : tests ciblés, types, lint/build, OpenAPI et jumelles ; rendu réel des deux PO et téléchargement inchangé après réimpression.
- [ ] Déploiement : appliquer les migrations nécessaires sur site et sur le Supabase propriétaire, recharger PostgREST et vérifier avec une session E2E réelle ; créer les deux modèles uniquement dans la société appropriée.

## État au 21 novembre 2026

- [x] V143 et sa jumelle Supabase sont identiques ; 127 paires de migrations synchronisées, V16 à V143.
- [x] V142 et V143 appliquées par Flyway sur PostgreSQL local (`qerp_reel`) et inscrites au registre Supabase du projet propriétaire `ymomubgdhufwtbsqqnas`.
- [x] Modèles `PO standard` portrait et `PO paysage - PO0004821` installés et publiés pour ROXGOLD SANGO dans les deux environnements administrables.
- [x] Tests SQL : installation idempotente, autorisations par type et société, snapshot, remplacement, reprise et rendu HTML. Les taxes sont indiquées « Non calculées » car les commandes n'ont pas de données de taxe.
- [x] Interface React, API Java, worker Edge et contrat OpenAPI raccordés. Vérifications : 40 tests frontend/worker, 19 tests Java ciblés (1 ignoré), `DocumentsArchivesIT`, `OpenApiContractIT`, `tsc --noEmit`, compilation Vite sans le module SWC natif.
- [x] API locale recompilée et démarrée sur `http://127.0.0.1:8093`, saine ; Gotenberg est sur le réseau Docker privé.
- [ ] Déploiement de la fonction Edge Supabase et secret `QERP_PDF_URL` : CLI/token Supabase absent, URL Gotenberg HTTPS joignable depuis le nuage non configurée. Le rendu nuage n'est pas activé.
- [ ] Le `.env` par défaut cible l'ancien projet Lovable `banqdfutzlrcvepovrin`, qui retourne PGRST205. Seul `.env.cloud` cible le projet propriétaire corrigé ; `npm run dev:cloud` choisit cet environnement. La destination par défaut n'a pas été changée pour éviter un basculement de données implicite.
