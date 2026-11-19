# 20 — Comptabilisation paramétrable par module (audit et plan, lot V105)

Audit du 18 novembre 2026 ; **livré le 19 novembre 2026 (V105)**, voir §5.

## 1. Constat

- **Un seul niveau de paramétrage** : un compte par rôle de comptabilisation et par société
  (`tenant_posting_accounts`, 21 rôles, modules AP, AR, FA, PAY, STK, TRE).
  - Aucun compte n'est codé en dur dans les fonctions de comptabilisation.
  - En revanche, on ne peut pas distinguer un client du groupe (4111) d'un client local (411), ni un
    fournisseur étranger (4012) d'un fournisseur local (401), ni les ventes de services (706) des
    ventes de marchandises (701), ni deux familles de stock (311 / 321).
- **Six écrans de paramètres montrent encore un panneau de comptabilisation statique et codé en
  dur** (`GLPostingConfigPanel`) : AP, immobilisations, notes de frais, approvisionnement, projets,
  ventes.
  - Le vrai panneau `PostingAccountsPanel` n'est branché que pour le grand livre, les comptes
    clients (AR, TRE), le stock (STK), la trésorerie (TRE) et les paramètres centraux.

## 2. Références

| Référence | Mécanisme |
|---|---|
| **SAP** | Détermination des comptes par opération (OBYC : BSX stock, WRX réceptions / factures non parvenues, GBB contrepartie), modulée par classe de valorisation de l'article. Compte collectif par groupe de comptes clients et fournisseurs. Compte de TVA par code TVA (OB40). Comptes par catégorie d'immobilisation. |
| **Sage 300** | Jeux de comptes sur chaque client (créances, acomptes, escomptes), chaque fournisseur (dettes, acomptes) et chaque article (stock, factures non parvenues, ajustements). Comptes de TVA par autorité fiscale. |
| **Sage X3** | Codes comptables sur client, fournisseur et produit, résolus par les journaux automatiques. |

Dans la base, la TVA (`tax_codes.gl_account_id`), la trésorerie (`bank_accounts.gl_account_id`) et
les immobilisations (`asset_categories`) ont déjà leur compte par objet.

## 3. Conception retenue

### Tables et données

- `posting_account_sets` (société, type `customer` | `supplier` | `item`, code, libellé, actif).
- `posting_account_set_lines` : jeu × rôle → compte de la société, avec une clé étrangère composite
  vers `gl_accounts`.
- Rôles admis par type, sous forme de données de référence (`posting_role_set_kinds`) :
  - client : `AR_RECEIVABLE`, `CUSTOMER_ADVANCE`, `SALES_REVENUE` ;
  - fournisseur : `AP_PAYABLE`, `PURCHASES`, `GRNI` ;
  - article : `INVENTORY`, `STOCK_VARIATION`.
- Colonnes `account_set_id` sur `customers`, `suppliers` et `items`, avec une clé étrangère
  composite.
- Fin de migration : `install_tenant_isolation_triggers()`.

### Résolution des comptes

`posting_account_for(société, rôle, jeu)` renvoie :

1. la ligne active du jeu ;
2. sinon le compte par défaut de la société.

`require_posting_account` gagne la même variante (QG001 si le compte manque).

Fonctions à faire passer par le jeu du tiers ou de l'article :

- **Jeu du client** : `on_ar_invoice_posted`, `create_ar_credit_note`, `letter_ar_invoice`,
  `apply_customer_credit`, `record_customer_advance`, `refund_customer_credit`, branche AR de
  `on_ap_payment_recorded`.
- **Jeu du fournisseur** : `ap_invoice_journal_entry`, `create_ap_credit_note`, branche AP de
  `on_ap_payment_recorded`, `on_gr_grni` (fournisseur de la commande), `on_supplier_return_grni`.
- **Budget, jeu du fournisseur** : `budget_committed`, `check_budget_on_po`,
  `check_budget_on_ap_invoice`. La demande d'achat n'a pas de fournisseur et garde le compte par
  défaut.
- **Jeu de l'article** : `on_stock_movement_je`.

### Garde-fous

Sur le modèle de SAP, qui interdit de changer le compte collectif ou la classe de valorisation
lorsqu'il reste des postes ouverts ou du stock :

- Changer le jeu d'un client est refusé tant qu'il a une facture émise non soldée ou un acompte non
  imputé.
- Changer le jeu d'un fournisseur est refusé tant qu'il a une facture approuvée non soldée ou des
  factures non parvenues ouvertes.
- Changer le jeu d'un article est refusé tant que son stock n'est pas nul.
- Une ligne de jeu sur un rôle de bilan (`AR_RECEIVABLE`, `CUSTOMER_ADVANCE`, `AP_PAYABLE`, `GRNI`,
  `INVENTORY`) ne se modifie ni ne se supprime tant qu'un membre du jeu a des postes ouverts.
- Nouveau code SQLSTATE : QG026.

### Droits

Nouveau droit du catalogue `accounting.account_sets` (admin, comptable). L'affectation d'un jeu
suit le droit de modification de la fiche concernée (client, fournisseur, article).

### Écrans

- Chaque page de paramètres de module reçoit un onglet « Comptabilisation » qui comprend les rôles
  du module (`PostingAccountsPanel modules=[…]`) et ses jeux de comptes :
  - Ventes : AR ;
  - AP : AP et TRE ;
  - Approvisionnement : AP (GRNI) et STK ;
  - Immobilisations : FA, avec un lien vers les catégories ;
  - Paie : PAY.
- Le panneau statique `GLPostingConfigPanel` disparaît.
- Notes de frais et projets, dont les modules sont encore à construire (lot 4) : un message honnête
  remplace les fausses valeurs.
- Le champ « Jeu de comptes » est ajouté aux fiches client, fournisseur et article.

### Tests

- `JeuxDeComptesIT` : résolution par jeu puis par défaut, chaque fonction, garde-fous, isolation.
- Mise à jour de `SchemaMigrationIT`.
- Parcours : création d'un jeu client « Groupe → 4111 », facture comptabilisée sur 4111,
  encaissement et lettrage sur 4111, changement de jeu refusé tant que la facture est ouverte.

## 4. Écart déjà existant, à traiter dans le même lot

Changer le compte **par défaut** d'un rôle de bilan dans `tenant_posting_accounts` n'est pas
protégé non plus : une facture comptabilisée sur l'ancien 411 serait encaissée sur le nouveau.
Le même garde-fou s'applique, tant que des tiers sans jeu ont des postes ouverts.

## 5. Livraison (V105, 19 novembre 2026)

Réalisé comme conçu ci-dessus, avec les précisions suivantes.

- **Base** :
  - 17 fonctions réécrites à partir de leur définition en service (remplacements exacts, vérifiés un à
    un).
  - Aucun appel « par défaut » ne reste pour un rôle porté par un jeu.
  - Les remplacements de compte et les migrations du plan redirigent aussi les lignes de jeux.
  - Le verrou se règle par société : `posting_settings.lock_control_accounts`, actif par défaut.
  - Le nouveau droit `accounting.account_sets` porte le catalogue à 105 codes.
- **Écrans** : chaque module a désormais un onglet « Comptabilisation » réel
  (`ModulePostingSettings`). Les panneaux statiques et les onglets « GL Mapping » / « GL Rules »
  factices sont supprimés.

| Module | Rôles | Jeux de comptes |
|---|---|---|
| Ventes | AR | client |
| Comptes clients | AR, TRE | client |
| Comptes fournisseurs | AP, TRE | fournisseur |
| Approvisionnement | AP, STK | fournisseur, article |
| Stocks | STK | article |
| Immobilisations | FA (+ comptes par catégorie) | — |
| Paie (RH → Paramètres) | PAY (+ comptes par rubrique) | — |
| Paramétrage central et grand livre | tous | tous + verrou |
| Notes de frais, projets | message clair : module à construire (lot 4), aucun compte utilisé | — |

- **Fiches** : le champ « Jeu de comptes » figure sur les fiches client, fournisseur et article.
- **Défaut corrigé en route** : la fiche client et la fiche fournisseur laissaient filer un refus
  d'enregistrement (droit, verrou…) en rejet non géré. Le refus reste affiché et la fiche reste
  ouverte.
- **Tests** :
  - `JeuxDeComptesIT` (4 tests) : client du groupe sur 4111 avec encaissement et lettrage sur le même
    compte ; fournisseur étranger 4012 / 604 ; matières en 321 ; verrou ; type de jeu ; compte
    inactif ; droit ; autre société.
  - Parcours **97** dans le nuage.
  - Java, Vitest, parcours nuage et sur site : tous verts.
- **Reste à faire** :
  - Endpoints API sur site pour les jeux. Sur site, les comptes par défaut s'appliquent et l'écran le
    dit.
  - Contrôle de classe des comptes de jeu dans `chart_of_accounts_issues`.
  - Jeux pour les catégories d'immobilisations : inutiles, la catégorie porte déjà ses comptes.
