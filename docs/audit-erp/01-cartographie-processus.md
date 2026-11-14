# 01 — Cartographie des processus et des modules

## 1. Architecture réelle

```
Navigateur (React 19, 112 pages)
   │  mode nuage : supabase-js + clé publique ──────────────► Supabase (PostgreSQL + Auth + RLS)
   │  mode sur site : VITE_QERP_API_URL ──► API Java 25 / Spring Boot 4.1 ──► PostgreSQL local
   │                                         (clients, factures et encaissements AR,
   │                                          paramétrage comptable, analytique, autorisations)
   └─ le reste (fournisseurs, achats, stock, GL, trésorerie, RH…) écrit toujours via Supabase
```

- **La logique métier est dans la base** : 135 tables, ~175 fonctions, déclencheurs de comptabilisation, de contrôle et de recalcul. Le même schéma (Flyway V1–V41 = migrations Supabase jumelles) sert le nuage et le sur site.
- **Sécurité** : RLS par société (`tenant_id = get_user_tenant_id(auth.uid())`), modèle d'autorisations central (catalogue de 49 droits, rôles système et personnalisés), fonctions SECURITY DEFINER pour les opérations contrôlées.
- **Conséquence clé pour l'audit** : tout ce que la RLS autorise est faisable **directement par l'API REST de Supabase** avec la clé publique et la session de l'utilisateur, quel que soit ce que l'écran propose. Un contrôle qui n'existe que dans l'écran n'est pas un contrôle.

## 2. Modules et niveau de réalité

| Domaine | Tables principales | Opérationnel | Partiel ou simulé |
|---|---|---|---|
| **Tiers** | customers, suppliers | Création, modification, recherche (nuage + API sur site pour les clients) | Pas de coordonnées bancaires, un seul identifiant fiscal, conditions de paiement non appliquées |
| **Ventes** | quotations, quote_lines, sales_orders, so_lines, delivery_notes, dn_lines | Numérotation par série (V40), devis → commande (`convert_quote_to_so`), livraison (`post_delivery`) | Facturation depuis livraison sans TVA ; stock livré décompté deux fois ; contrôle de crédit = notification seulement ; `on_so_confirmed` vide |
| **Clients (AR)** | ar_invoices, ar_invoice_lines, payments, tax_codes, ar_numbering_series | Facture à lignes, TVA par ligne, numérotation légale à l'émission, comptabilisation par rôles, encaissement par tiers (V36) | Pas d'avoir, d'acompte, de lettrage, de relance exécutée ; facture émise modifiable en base |
| **Achats** | purchase_requisitions, requisition_lines, purchase_orders, po_lines, goods_receipts, gr_lines, procurement_approvals | Cycle complet V34–V39 : brouillon → soumission → approbation par niveaux et séparation des tâches → réception partielle contrôlée | Pas de RFQ, de retour fournisseur, de réception de services distincte ; pas d'écriture à la réception (GR/IR) |
| **Fournisseurs (AP)** | ap_invoices, ap_invoice_approvals, payments | V41 : soumission avec contrôles des paramètres, 3 voies avec tolérance, approbation par niveaux, comptabilisation V37, règlement par tiers | Facture sans lignes ; pas d'avoir ; retenues à la source paramétrées mais non appliquées |
| **Stock** | items, warehouses, item_locations, stock_movements, stock_valuation_layers, inventory_counts | CMP et couches FIFO, inventaire, transfert, clôture | Tables modifiables directement ; comptabilisation par codes en dur et silencieuse |
| **Grand livre** | gl_accounts, journal_entries, journal_lines, journal_batches, accounting_journals, gl_audit_logs | Équilibre, intangibilité (V38), journaux, numéros de pièce, lots, balance, grand livre, contre-passation, périodes | Pas de lettrage ; piste d'audit MD5 effaçable ; bilan et résultat calculés par type de compte, pas au format SYSCOHADA |
| **Trésorerie** | bank_accounts, bank_transactions, bank_statements, bank_statement_lines, bank_reconciliations | Comptes, relevés, suggestions de rapprochement, clôture, prévision 13 semaines | Paiements AR/AP non reliés à un compte bancaire ni à un mouvement ; caisse = banque ; mono-devise |
| **Budget** | budgets, budget_lines | Budget par compte, département, période | Engagement imputé en réalisé (défectueux) ; pas de contrôle avant approbation ; écrans de prévision codés en dur |
| **Immobilisations** | assets, asset_categories, depreciation_entries, asset_disposals | Registre | Dotations et cessions **impossibles à exécuter** (colonnes inexistantes) |
| **Paie / RH** | employees, payroll_runs, payroll_lines | Cycle de paie avec approbation et comptabilisation | Comptes et taux patronal codés en dur |
| **Notes de frais, projets, risques, conformité, CRM** | expense_reports, projects, risk_register, compliance_controls, crm_* | CRM opportunité → devis | Plusieurs écrans de reporting et de contrôle alimentés par des tableaux de démonstration |
| **Transversal** | fiscal_years, fiscal_periods, period_locks, erp_* , tenant_invitations | Calendrier fiscal central (V33), autorisations (V23–V32), invitations (V31) | — |

## 3. Processus de bout en bout et dépendances

```
O2C   Client ─► Devis ─► Commande ─► Livraison ─► Facture AR ─► Écriture VT ─► Encaissement ─► Écriture BQ ─► (Rapprochement bancaire)
                 V40       V40         post_delivery   V21/V22      V18/V38         V36             V34              ⚪ non relié
                                       🔴 stock ×2      🔴 si issue de livraison : TVA 0, n° aléatoire

P2P   Demande ─► Approbation ─► Commande ─► Approbation ─► Réception ─► Facture AP ─► 3 voies ─► Approbation ─► Écriture AC ─► Paiement ─► Écriture BQ
       V39         V39            V35/V39     V39            V34          V41          V41        V41            V37             V36          V34
                                   │                          └─► mouvement de stock (CMP) ─► écriture stock 🔴 codes en dur / silencieuse
                                   └─► budget 🔴 imputé en réalisé

R2R   Écritures auxiliaires + manuelles ─► Journaux / lots (V38) ─► Balance ─► Grand livre ─► États (bilan, résultat, SIG) 🟡 ─► Clôture de période (V33) ─► Clôture d'exercice ⚪

B2C   Budget ─► Engagement (commande) 🔴 ─► Réalisé (facture) ⚪ ─► Budget / réel 🟡

I2F   Article ─► Réception (+) ─► Transfert ─► Livraison (−) 🔴 ─► Inventaire ─► Valorisation CMP/FIFO ─► Écriture stock 🔴

C&T   Règlements AR/AP ─► (aucun lien) ─► Mouvements bancaires ◄─ Relevés ─► Rapprochement ─► Clôture trésorerie
```

## 4. Dépendances entre modules (qui appelle qui)

| Source | Cible | Mécanisme | État |
|---|---|---|---|
| Ventes (livraison) | Stock | `post_delivery` : UPDATE items **et** INSERT stock_movements « posted » | 🔴 double décompte |
| Ventes (livraison) | AR | `auto_invoice_on_delivery` (déclencheur) / `invoice_from_delivery` (RPC) | 🔴 TVA 0, numéro aléatoire |
| AR | GL | `on_ar_invoice_posted`, rôles de comptabilisation | ✅ |
| AR / AP règlements | GL | `on_ap_payment_recorded` (INSERT seulement) | 🟡 suppression / modification non répercutées |
| AR / AP règlements | Trésorerie | aucun | ⚪ |
| Achats (réception) | Stock | `on_gr_completed` → mouvement unique au coût de la commande | ✅ (V34) |
| Stock | GL | `on_stock_movement_je` : comptes 3100 / 6010 / 4010 / 6580 codés en dur, sortie silencieuse | 🔴 |
| Achats (commande) | Budget | `commit_budget_on_po` | 🔴 |
| AP | GL | `ap_invoice_journal_entry` (V37) | ✅ |
| Paie | GL | `post_payroll_run` : comptes 6610 / 6630 / 4210 / 4310 / 4470 codés en dur | 🟡 🧮 |
| Immobilisations | GL | `post_monthly_depreciation`, `post_asset_disposal` | 🔴 ne s'exécutent pas |
| Tous | Calendrier fiscal | `assert_fiscal_period_open` (QG003) | ✅ |
| Tous les journaux | Lots GL | `assign_journal_batch` (V38) | ✅ |
