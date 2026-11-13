# QUOREICH — Audit préalable au Lot 3 (fournisseurs, Grand livre, achats)

Date : 13 novembre 2026. Règle appliquée : avant chaque lot, auditer l'existant réel et le comparer aux références (SAP, Sage 300, Sage X3, OHADA) pour ne rien oublier.

## Méthode

- Critères d'acceptation du cahier des charges : **AP-REC**, **GL-REC**, **ACH-REC** (chapitres 07 à 09), et règles transversales FIN-01 à FIN-07.
- Existant mesuré sur la copie des données réelles (`qerp_reel`, en V33) : lecture des tables, politiques RLS, déclencheurs et fonctions, et essais en transaction annulée. Rien n'a été modifié.
- Références : cycle achat → paiement de SAP (commande, entrée de marchandise, contrôle facture MIRO avec tolérances et blocage de paiement, compte d'attente GR/IR), de Sage X3 (réception, rapprochement, bon à payer, factures non parvenues) et de Sage 300 (contrôle des doublons de factures, numéros de documents uniques).

## Critères d'acceptation à atteindre

| Critère | Énoncé (cahier des charges) |
|---|---|
| AP-REC | Facture approuvée → paiement autorisé ; non approuvée → refus serveur ; paiement répété → pas de doublon ; écarts de rapprochement visibles et traitement justifié |
| GL-REC | Déséquilibre refusé ; écriture comptabilisée immuable ; contre-passation équilibrée ; période verrouillée protégée ; états rapprochables aux écritures source |
| ACH-REC | Parcours complet rapproché ; réception partielle contrôlée ; dépassement/tolérance traité ; paiement interdit en cas de blocage ; relance sans doublon de stock ni de comptabilité |

## Constats sur l'existant (mesurés)

### Fournisseurs (AP)

| # | Constat | Gravité |
|---|---|---|
| AP-1 | **L'approbation n'est qu'une colonne.** `approval_status` se modifie par une simple mise à jour ; la politique de `ap_invoices` est « Tenant isolation » FOR ALL : tout membre de la société, un lecteur compris, peut approuver une facture, y compris celle qu'il a saisie (aucune séparation des tâches). L'écran fait exactement cela (`APTransactions.tsx`, `handleApprove`). | Critique |
| AP-2 | **Seuils, file d'approbation, numérotation, retenues à la source, « commande obligatoire » et « rapprochement à trois voies » sont décoratifs** : créés par `seed_ap_defaults`, lus par aucune fonction. | Haute |
| AP-3 | **Paiement par n'importe quel membre** : `payments` est en FOR ALL pour la société ; seul `guard_ap_payment` vérifie que la facture est approuvée (ce point d'AP-REC est donc acquis, mais vidé de son sens par AP-1). | Critique |
| AP-4 | **Comptabilisation d'une facture avec des comptes codés en dur** (4010 / 6010 / 4320) et **silencieuse en cas de compte manquant** (`RAISE WARNING`) : facture approuvée sans écriture, AP et GL divergent. L'AR a été corrigé aux V17/V18 ; l'AP non. | Haute |
| AP-5 | **Aucune protection contre le paiement en double** (même requête rejouée) ; idem pour les encaissements AR. | Haute (AP-REC) |
| AP-6 | **Aucun contrôle des factures fournisseurs en double** : pas d'unicité (société, fournisseur, numéro de facture). Sage 300 et Sage X3 avertissent ou bloquent. | Haute |
| AP-7 | **Factures sans lignes** : en-tête seul ; pas de TVA par ligne, ni de rattachement ligne à ligne à la commande (AP-02). | Moyenne |
| AP-8 | **Écritures de paiement mal datées** : `on_ap_payment_recorded` ne renseigne pas `entry_date` → date du jour (valeur par défaut), et non `payment_date`. Un paiement saisi à une date passée est comptabilisé dans la mauvaise période. Même défaut pour les encaissements AR. | Haute (GL-REC) |

### Grand livre (GL)

| # | Constat | Gravité |
|---|---|---|
| GL-1 | **La politique « Access via entry » (FOR ALL) sur `journal_lines`** s'ajoute aux politiques « comptable ou administrateur » et les annule : tout membre peut ajouter, modifier ou supprimer des lignes d'une écriture en brouillon. | Haute |
| GL-2 | Équilibre débit = crédit (`enforce_balanced_entry`), immuabilité des écritures comptabilisées (`protect_posted_*`), contre-passation datée et motivée (`reverse_journal_entry(_entry_id, _reverse_date, _reason)`), verrou de période (V33) : **présents**, à couvrir par des tests de recette. | — |
| GL-3 | **Chaîne d'audit faible** : MD5 tronqué à 8 caractères, horodatage inclus dans le calcul, **aucune fonction de vérification** de la chaîne (GL-06). | Moyenne |
| GL-4 | Balance (`gl_trial_balance`) et grand livre détaillé (`gl_ledger_detail`) existent (vues `security_invoker`) ; **aucun état de rapprochement** AP↔GL ni AR↔GL. | Moyenne (GL-REC) |
| GL-5 | Clôture d'exercice comptable (report à nouveau, résultat) absente ; prévue à ce lot (V33 n'a livré que le calendrier). | Moyenne |

### Achats (ACH)

| # | Constat | Gravité |
|---|---|---|
| ACH-1 | **Double comptage du stock à la réception** : `on_gr_completed` insère un mouvement de stock (que `apply_stock_movement` ajoute déjà) **et** met à jour la quantité directement. Essai réel : 5 unités reçues → stock de 0 à **10**. | Critique |
| ACH-2 | **Réception sans contrôle** : une commande déjà « reçue » accepte une nouvelle réception (sur-réception) ; une réception partielle fait passer la commande à « reçue ». | Haute |
| ACH-3 | **Aucune écriture à la réception** (SAP/X3 : stock ou charge au débit, compte d'attente « factures non parvenues » au crédit). | Haute |
| ACH-4 | **Rapprochement à trois voies inexistant** : `procurement_match_decisions` enregistre une décision, mais rien ne compare commande, réception et facture ; aucune tolérance ; `guard_ap_payment` ignore le rapprochement. | Critique (ACH-REC) |
| ACH-5 | Demandes, commandes, réceptions, décisions et approbations d'achat en FOR ALL pour tout membre ; les gardes `guard_po_approval` / `approve_procurement_step` existent mais les tables restent modifiables en direct. | Haute |
| ACH-6 | Engagement budgétaire à la commande (`commit_budget_on_po`) : présent ; consommation à la facture et libération à l'annulation à vérifier (ACH-05). | Moyenne |

## Comparaison avec les références

| Contrôle de référence | SAP | Sage X3 | Sage 300 | QUOREICH aujourd'hui |
|---|---|---|---|---|
| Approbation par un tiers habilité, seuils par montant | workflow de libération | bon à payer, circuits | approbation (souvent module tiers) | colonne modifiable par tous (AP-1, AP-2) |
| Contrôle facture en double | référence + fournisseur + montant | avertissement sur la référence | fournisseur + montant ou date : ignorer / avertir / bloquer | aucun (AP-6) |
| Réception → écriture d'attente | GR/IR | factures non parvenues | réception PO | aucune (ACH-3) |
| Rapprochement commande / réception / facture | MIRO, clés de tolérance (prix, quantité) | rapprochement, écarts | rapprochement PO | aucun (ACH-4) |
| Facture hors tolérance → paiement bloqué, levée explicite | blocage « R », libération séparée | blocage du bon à payer | — | aucun (ACH-4) |
| Paiement en double évité | programme de paiement sur postes ouverts | — | contrôle des paiements en double | aucun (AP-5) |
| Numéros de documents uniques | oui | oui | oui | AR depuis V22 ; AP non (AP-2) |

## Principe transversal : en-tête, lignes, pied

Demandé par le propriétaire (13 nov. 2026). Les références découpent toute pièce commerciale en trois zones qui n'ont pas le même rôle :

| Zone | Contenu | Référence |
|---|---|---|
| **En-tête** | tiers, date de pièce et date comptable, référence externe (n° de facture fournisseur), devise, conditions de paiement (reprises de la commande, sinon du tiers), statut ; pour une facture fournisseur, **le montant TTC et la TVA annoncés par le fournisseur**, saisis comme montants de contrôle | SAP MIRO : « header data : invoice number and date, gross invoice amount and tax amount, invoicing party, terms of payment » ; conditions copiées de la commande, sinon de la fiche fournisseur |
| **Lignes** | article ou compte, description, quantité, prix unitaire, remise de ligne, code TVA, montants calculés, analytique, lien vers la ligne d'origine (commande → réception → facture) | SAP : « item overview » ; Sage : lignes de pièce |
| **Pied** | totaux **calculés** HT / TVA par code / TTC, éléments de facturation du pied (frais de port, remise ou escompte de pied), acomptes déduits, **net à payer**, échéancier ; pour la facture fournisseur, **l'écart** entre le TTC annoncé à l'en-tête et le total calculé | SAP : onglet « Tax » (TVA par code) et indicateur de solde, qui doit être à 0 pour comptabiliser ; Sage 100 / X3 : pied de pièce (frais, échéances), les frais du pied ne font pas partie de la valorisation des lignes |

Règles qui en découlent pour QUOREICH :
1. Les montants du pied sont **calculés** à partir des lignes et des éléments de pied, jamais saisis.
2. Facture fournisseur : le montant annoncé à l'en-tête est un **contrôle** ; elle ne se valide que si l'écart du pied est nul (comme le solde de MIRO).
3. Une pièce se crée en brouillon / en attente, reçoit ses lignes, puis se valide ; validée, ses trois zones sont figées ; une pièce validée sans ligne est refusée.
4. À l'écran : bloc d'en-tête en haut, grille de lignes au milieu, pied en bas (totaux par taux de TVA, frais, net à payer, écart), en lecture seule.

| Pièce | État |
|---|---|
| Facture client | en-tête + lignes depuis V21 (totaux = somme des lignes) ; pas encore d'éléments de pied ni d'échéancier |
| Commande d'achat | lignes ; total recalculé par `recompute_po_total` ; pas de pied distinct |
| Réception | en-tête puis lignes puis validation, figée, lignes rattachées à la commande : **V34** |
| Facture fournisseur | **en-tête seul** → lignes, TVA par ligne, rattachement aux lignes de commande et de réception, montant de contrôle et écart au pied (étape 4) |
| Paiement | une ligne par facture réglée aujourd'hui ; affectation à plusieurs factures à étudier avec l'idempotence (étape 4) |

## Plan proposé pour le Lot 3

Ordre : d'abord ce qui fausse les données ou ouvre une faille, ensuite les contrôles métier, enfin l'API Java et la recette.

1. **Correctifs critiques (base de données, deux chemins)**
   - Stock compté une seule fois à la réception ; réception plafonnée à la quantité commandée restante ; statut « partiellement reçue » (ACH-1, ACH-2).
   - Écritures de paiement datées de `payment_date`, AR et AP (AP-8).
   - Politique « Access via entry » retirée (GL-1).
2. **Approbations et droits (AP, achats)**
   - Droits du catalogue : `ap.create`, `ap.approve`, `ap.pay`, `procurement.receive`, `procurement.match` ; écritures directes refusées, tout passe par des fonctions.
   - Approbation AP par niveaux selon `ap_approval_thresholds`, approbateur différent du saisisseur, historique dans `ap_approval_queue` (AP-1, AP-2, AP-3, ACH-5).
3. **Comptabilisation fournisseurs et réception**
   - Facture AP par rôles de comptabilisation (`AP_PAYABLE`, `PURCHASES`, `VAT_INPUT`), refus `QG001` si incomplet (AP-4).
   - Écriture à la réception sur un compte d'attente « factures non parvenues », soldé par la facture (ACH-3) — rôle de comptabilisation nouveau, à faire valider par l'expert-comptable.
4. **Contrôles de la facture fournisseur**
   - Unicité (société, fournisseur, numéro de facture) (AP-6) ; numérotation interne AP (V22 étendue).
   - Lignes de facture AP et TVA par ligne (AP-7).
   - Rapprochement à trois voies ligne à ligne, tolérances paramétrées (prix, quantité), blocage de paiement hors tolérance, levée motivée et habilitée (ACH-4) ; options « commande obligatoire » et « rapprochement à trois voies » enfin appliquées.
   - Paiement idempotent (clé d'idempotence par opération) (AP-5).
5. **Grand livre**
   - Chaîne d'audit SHA-256 et fonction de vérification (GL-3).
   - États de rapprochement AP↔GL et AR↔GL (GL-4).
   - Clôture d'exercice : report à nouveau et résultat, avec le calendrier V33 (GL-5).
6. **API Java** : tranches AP et achats, avec tests de parité comme au Lot 2.
7. **Recette** AP-REC, GL-REC, ACH-REC sur la copie réelle, puis procès-verbal.
8. **Écrans sans données fictives** (ajouté le 14 nov. 2026, revue des processus) : les pages achats, fournisseurs et grand livre encore alimentées par des tableaux codés en dur passent sur les données réelles ou affichent explicitement « non disponible » — liste dans `docs/revue-processus-metier.md` §5.

## Décisions à prendre avant de coder

1. **Écriture à la réception** : passer une écriture d'attente à la réception (comme SAP/X3) ou seulement à la facture ? Recommandé : à la réception, sur un compte « factures non parvenues » à faire valider par l'expert-comptable.
2. **Tolérances du rapprochement** : valeurs par défaut proposées — 2 % sur le prix unitaire, 0 % sur la quantité (pas de sur-réception), modifiables par société.
3. **Facture en double** : bloquer (recommandé) ou seulement avertir.
4. **Approbation** : approbateur obligatoirement différent du saisisseur, y compris pour l'administrateur (recommandé).

## Sources consultées

- SAP : [Invoice tolerance keys](https://blogs.sap.com/?p=105339), [Entering invoices with variances](https://learning.sap.com/courses/invoice-verification-in-sap-s-4hana/entering-invoices-with-variances-1), [Variances and invoice block](https://learning.sap.com/courses/invoice-verification-in-sap-s-4hana-jp/variances-and-invoice-block-1), [Three-way invoice control](https://masteringsap.com/articles/use-a-three-way-invoice-control-assessment-to-reduce-the-risk-of-fraud-and-money-loss/).
- Sage X3 : [Bon à payer](https://www.cleverence.com/articles/sage-dev-documentation/documentation-technique-bon-a-payer-sage-developer-4821/), [Saisir une facture d'achat](https://www.cleverence.com/articles/sage-documentation/saisir-une-facture-d-achat-7391/), [Doublon de référence fournisseur](https://communityhub.sage.com/us/sage_x3/f/general-discussion/101313/duplicate-source-document/282599).
- Sage 300 : [Prévenir les factures en double](https://www.greytrix.com/blogs/sageaccpacerp/2018/03/12/prevent-duplicate-invoices-in-accounts-payable/), [Paiements en double](https://www.greytrix.com/blogs/sageaccpacerp/2023/01/13/control-duplicate-payment-entries-in-account-payable).
- En-tête, lignes et pied : [SAP — Entering the Invoice](https://help.sap.com/saphelp_46c/helpdata/en/bf/cd275a8dfb11d383fc0000e8a5eb64/content.htm), [SAP Learning — Invoice entry](https://learning.sap.com/courses/invoice-verification-in-sap-s-4hana-jp/invoice-entry-1), [Sage 100 — pied de document d'achat](https://communityhub.sage.com/fr/sage-100/f/discussion-generale/250091/difference-affichage-total-pied-de-page-pied-de-document-d-achat/599621), [Sage X3 — éléments de facturation](https://communityhub.sage.com/fr/sage-x3/f/technique/215689/calcul-des-elements-de-facturation-sur-une-autre-base).
- Rapprochement à trois voies (généralités) : [Spendesk](https://www.spendesk.com/fr/blog/rapprochement-a-trois-voies/).
