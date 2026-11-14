# 07 — Revue de l'architecture technique

## 1. Ce qui est sain

| Point | Pourquoi c'est un atout |
|---|---|
| Logique dans PostgreSQL (déclencheurs, fonctions, vues) partagée par le nuage et le sur site | Une seule source de vérité pour deux déploiements ; migrations jumelles vérifiées en CI (`db:check-twins`) |
| RLS par société + `get_user_tenant_id` lu dans `profiles` (non modifiable depuis V24) | Isolation des **lectures** solide ; un jeton ne peut pas élargir le périmètre |
| Modèle d'autorisations unique (catalogue, rôles, `has_permission`, `my_access`) | Les écrans affichent les droits réels de la base |
| Gardes « non SECURITY DEFINER » qui regardent `current_user` (V24, V34, V39, V41) | Bloquent l'écriture directe sans gêner les fonctions contrôlées : **le bon motif, à généraliser** |
| API Java : `qerp_api` non propriétaire, sans BYPASSRLS, contrôlé au démarrage ; contrat OpenAPI figé | Le chemin sur site ne contourne pas la RLS |
| Tests contre une vraie base (Testcontainers) + parcours de bout en bout qui conservent leurs données | Les régressions de sécurité et de comptabilité sont visibles |

## 2. Risques techniques

| # | Risque | Constat | Gravité |
|---|---|---|---|
| T-01 | **Politiques `FOR ALL` « Tenant isolation » sur les tables transactionnelles** | Constaté sur les tables contrôlées : `payments`, `ar_invoices`, `items`, `stock_movements`, `budgets`, `gl_accounts`, `gl_audit_logs`, `bank_*`, `expense_reports`, `customers`, `suppliers`, `quotations`, `sales_orders`… Tout membre (y compris « Lecteur ») peut INSERT / UPDATE / DELETE via l'API REST. Les écrans n'en sont pas la limite | Critique |
| T-02 | **Fonctions SECURITY DEFINER qui font confiance à un identifiant reçu** | `recompute_ar_invoice_from_payment` met à jour la facture citée sans vérifier sa société (→ S13) ; `post_monthly_depreciation(_tenant_id)` et `post_asset_disposal(_asset_id)` n'ont aucun contrôle de société ni de droit, exécutables par `authenticated` | Critique |
| T-03 | Déclencheurs AFTER INSERT seulement pour la comptabilisation des paiements | Suppression / modification non répercutées | Critique |
| T-04 | Code hérité (époque Lovable) incohérent avec le schéma | Colonnes inexistantes (`journal_entries.reference`, `journal_lines.journal_entry_id`), écriture insérée « posted » sans lignes (refusée par `enforce_balanced_entry`) ; `on_so_confirmed` vide ; numéros aléatoires | Haute |
| T-05 | Numéros de compte codés en dur | `on_stock_movement_je`, `post_payroll_run`, `post_monthly_depreciation` contournent `posting_account` | Haute |
| T-06 | Statuts en texte libre sans `CHECK` | Aucune table de pièces ne contraint `status` | Moyenne |
| T-07 | Pas d'idempotence | Aucune clé d'idempotence ; pas de contrainte d'unicité sur `payments` (référence) | Moyenne |
| T-08 | Concurrence | Bonnes pratiques présentes par endroits (`FOR UPDATE` dans `post_delivery`, compteurs de numéros verrouillés) ; absentes dans `invoice_from_delivery`, `confirm_so` (ne lit pas `FOR UPDATE`, ne vérifie pas le statut) | Moyenne |
| T-09 | Piste d'audit | MD5 tronqué à 8 caractères, horodatage dans le calcul, aucune fonction de vérification, table effaçable | Critique (avec T-01) |
| T-10 | Deux chemins d'accès en sur site | Seuls AR / clients / paramétrage passent par l'API ; le reste écrit encore dans Supabase → **un déploiement sur site complet n'est pas possible** | Haute (produit) |
| T-11 | Types générés (`types.ts`) en retard sur le schéma | Nombreux `(supabase as any)` ; 518 avertissements lint | Faible |
| T-12 | Mono-devise | Aucune colonne devise / taux sur les pièces | Haute (fonctionnel) |
| T-13 | Sauvegarde / restauration | Dump manuel hors dépôt ; pas de procédure de restauration testée régulièrement ni de PITR documenté pour le sur site | Moyenne |
| T-14 | Fonctions d'Edge (IA) | Gemini en offre gratuite : pas de données client réelles (règle du propriétaire) | Information |

## 3. Sécurité et gouvernance (Phase 7)

| Contrôle | État | Preuve |
|---|---|---|
| Authentification | ✅ Supabase Auth (ES256) ; API valide les mêmes jetons ; Keycloak sur site à faire | Parcours sur site |
| Isolation inter-sociétés en lecture | ✅ | `TenantIsolationIT`, V24, V27, V31 |
| Isolation inter-sociétés en écriture | 🔴 | S13 (paiement), T-02 (immobilisations) |
| Élévation de privilège : lecteur → écriture comptable | 🔴 | S1, S3, S4, S6, S7, S12, S14, S15, S18 |
| Élévation : changer de société, s'attribuer un rôle | ✅ fermé | V24, V26, V31 |
| Séparation des tâches | ✅ achats, AP ; ⚪ AR, budget, notes de frais, trésorerie | IT V39, V41 |
| Journal des modifications | ✅ autorisations, calendrier ; 🔴 GL | — |
| Établissements (multi-sites dans une société) | ⚪ | — |
| Documents sensibles (bulletins de paie) | 🟢 RLS `has_hr_perm` sur `payroll_runs` | — |
| Conservation (10 ans, AUDCIF art. 24) | ⚪ politique non définie ; suppression possible (T-01) | — |
| Sauvegarde / restauration | 🟡 | T-13 |

## 4. Recommandations d'architecture (sans réécriture)

1. **Généraliser le motif V39 / V41** à toutes les tables transactionnelles : écritures directes refusées par une garde `current_user IN ('authenticated','anon','qerp_api')`, toutes les transitions par des fonctions qui vérifient société, droit, statut et séparation des tâches. Pour les tables de référence (tiers, articles), restreindre UPDATE / DELETE aux droits du catalogue.
2. **Règle d'or des fonctions SECURITY DEFINER** : société résolue par `get_user_tenant_id(auth.uid())`, jamais reçue en paramètre ; toute ligne référencée relue avec `AND tenant_id = _tenant`.
3. **Comptabilisation uniquement par rôles** (`posting_account`) avec refus QG001 ; ajouter les rôles `INVENTORY`, `COGS`, `GRNI`, `STOCK_VARIANCE`, `CASH`, `PAYROLL_*`, `DEPRECIATION_*`, `CUSTOMER_ADVANCE`, `SUPPLIER_ADVANCE`, `FX_GAIN`, `FX_LOSS`.
4. **Paiement immuable** ; annulation = fonction de contre-passation (comme `reverse_journal_entry`).
5. **Contraintes `CHECK`** sur les statuts et **clé d'idempotence** (`payments.idempotency_key` unique par société).
6. Une **sonde de sécurité automatique** (IT Java) qui rejoue S1–S18 en lecteur et exige un refus pour chacune : elle aurait détecté T-01 et T-02.
