# 14 — Factures fournisseurs à lignes et factures non parvenues (lot A4, V72)

Audit de l'existant du 15 nov. 2026, comparé à SAP, Sage et au SYSCOHADA révisé, puis livraison.
Écarts traités : **G-17** (facture à lignes, 3 voies ligne à ligne) et **G-18** (écriture de réception sur
408). Étape 3 de la priorité P1 de la feuille de route (09).

## 1. Constats

| # | Constat | Preuve | Conséquence |
|---|---|---|---|
| A-1 | Facture fournisseur saisie en en-tête seul | `ap_invoices` : HT et TVA tapés ; panneau « les lignes arrivent au Lot 3 » | TVA déductible approximative, aucun lien facture ↔ ligne de commande |
| A-2 | Rapprochement à 3 voies global | `ap_invoice_submit` compare le HT au reçu non facturé de toute la commande | Une ligne surfacturée passe si une autre est sous-facturée ; prix jamais contrôlé |
| A-3 | Aucune écriture à la réception | `on_gr_completed` : mouvement de stock seulement | Charges de la période sous-évaluées tant que la facture n'est pas arrivée |
| A-4 | Table des factures fournisseurs en `FOR ALL` | politique « Tenant isolation » | Un lecteur pouvait créer ou modifier une facture en brouillon |

## 2. Références

* **SAP** (MIRO) : chaque ligne de facture cite un poste de commande ; contrôle quantité (≤ reçu − déjà facturé) et prix
  (tolérances) ; compte d'attente GR/IR crédité à la réception, débité par la facture ; écart de prix en charge ou en stock.
* **Sage X3** : factures non parvenues à la réception (paramétrable), soldées par la facture.
* **SYSCOHADA révisé** : 408 « Fournisseurs, factures non parvenues » ; l'écriture systématique à la réception est un
  choix de méthode **à valider par l'expert-comptable** (d'où un paramètre désactivé par défaut).

## 3. Livré (V72)

* **Lignes de facture fournisseur** (`ap_invoice_lines`) : libellé, quantité, prix, remise, code TVA, compte de charge,
  ligne de commande ; en-tête = somme des lignes ; **montant TTC de contrôle** (celui du papier) vérifié à la soumission.
  Saisie : lignes libres ou « Reprendre les lignes reçues non facturées » (quantité restante au prix commandé).
* **3 voies ligne à ligne** à la soumission : quantité ≤ reçu (net des retours) − déjà facturé, prix ≤ prix commandé, à la
  tolérance des paramètres d'achat près ; message par ligne. Le contrôle global reste pour les factures sans ligne de commande.
* **Factures non parvenues** (paramètre « Comptabiliser les réceptions en factures non parvenues (408) », Approvisionnement
  → Paramètres → Contrôles et suivi) : réception = DR achats / CR 408 au prix de la commande ; retour = contre-passation de
  la part non facturée ; facture = DR 408 pour la valeur reçue, **écart de prix en charge** ; registre `grni_ledger` par
  ligne de commande. Rôle **GRNI** (408) ajouté au référentiel et aux sociétés.
* **Comptabilisation par ligne** : charge par compte (ligne, sinon rôle Achats), TVA par compte du code TVA (sinon TVA
  récupérable), fournisseur pour le TTC.
* **Droit `ap.invoice`** (saisir et modifier les factures fournisseurs) : administrateur, comptable, contrôleur des achats.

## 4. Restant

* TVA non récupérable (code TVA « non déductible » imputé en charge) 🧮.
* Retenues à la source sur règlement (G-31) 🧮.
* Écart de prix porté en stock (valorisation au coût réel) plutôt qu'en charge, selon la méthode d'inventaire.
