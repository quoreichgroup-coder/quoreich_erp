# 19 — Impressions, exports et actions groupées ; écarts restants pour le MVP

État au 18 novembre 2026, après le lot « impressions et actions groupées » (cœur : ventes, clients,
achats, fournisseurs, stocks, comptabilité, trésorerie, budget, immobilisations, RH et paie).

## 1. Références

- **SAP S/4HANA** : sortie des pièces par message (facture, commande, bon de livraison, avoir),
  traitement de masse (libération groupée des demandes et commandes, ME28 / ME55 ; validation des
  factures MRBR), brouillard / journal des pièces (S_ALR_87012287).
- **Sage 300 / Sage X3** : impression des pièces avec mise en page, édition des listes en PDF ou
  Excel depuis chaque écran de consultation, sélection multiple des lignes et actions groupées
  (validation, suppression, impression).
- **OHADA / SYSCOHADA (AUDCIF)** : pièce justificative datée et numérotée (art. 19), identité du
  vendeur et du client professionnel sur la facture (CGI du Burkina Faso, art. 562 et 564),
  « montant arrêté en lettres » sur les pièces de règlement, bulletin de paie à conserver.

## 2. Ce que le lot apporte

### Moteur de pièces (`src/lib/document-pdf.ts`, `src/components/DocumentDetail.tsx`)

- Une seule mise en page pour toute pièce, en **PDF A4** et en **Excel** (même contenu : identité de
  la société, titre, en-tête, lignes avec les montants restés **nombres** dans Excel, totaux, montant
  en lettres, mentions, cadres de signature), plus le CSV existant.
- Options par pièce : devise du montant en lettres (XOF / XAF → « francs CFA », EUR, USD, GNF…),
  montant en lettres seulement pour les pièces commerciales, mentions, signatures, orientation.
- Défauts trouvés en regardant un vrai PDF et corrigés :
  - Le titre long chevauchait la raison sociale.
  - Les montants s'imprimaient « 125/000 ». L'espace fine insécable du format `fr-FR`
    n'existe pas dans la police du PDF ; le défaut touchait aussi **tous les exports de listes**.
    Correction par `pdfSafe`, commun aux deux moteurs.
  - Les dates s'imprimaient en ISO ; elles sortent maintenant en JJ/MM/AAAA.
  - Les conditions de paiement n'avaient pas d'unité.
- `DocumentPrintButtons` : « Imprimer » + « Excel » pour une pièce construite à la demande par
  n'importe quel écran.

### Pièces imprimables

| Famille | Pièce | Écran |
|---|---|---|
| Commerciales | Devis, commande, livraison (signature du client), facture client (identité et IFU du client, conditions), avoir, relevé de compte, retour client | Ventes, Comptes clients |
| | Demande d'achat, commande, réception (signatures), facture fournisseur (bon à payer), retour fournisseur | Approvisionnement, Comptes fournisseurs |
| Comptables et paie | Écriture (signatures), **brouillard des écritures sélectionnées** | Grand livre → Transactions |
| | Bulletin de paie au format pièce (net à payer en lettres, signatures employeur / salarié) ; livre de paie (export existant avec aperçu) | RH → cycles de paie |
| Stock et immobilisations | **Bon d'ajustement / de transfert / de mouvements** de la sélection | Stocks → Transactions |
| | **Feuille de comptage** imprimable (comptage à l'aveugle, sans quantité théorique) | Inventaires physiques |
| | **Fiche d'immobilisation** avec les dotations comptabilisées mois par mois | Immobilisations → Données de base |
| Budget et trésorerie | **Budget** (lignes, sections, signatures préparé / approuvé) | Budget → Transactions |
| | **État de rapprochement bancaire** | Trésorerie → Contrôle |
| | **Ordre de virement** (sélection de virements) ou bordereau des mouvements | Trésorerie → Transactions |

### Exports de listes

- `ExportButtons` (16 écrans) gagne **PDF** à côté d'Excel et CSV. Quatre écrans désactivent ce
  bouton (`pdf={false}`), parce qu'ils ont déjà leur propre PDF avec masquage ou aperçu : budget →
  rapports, employés, rapports RH, cycles de paie.
- Les 20 boutons CSV seuls passent par `ExportMenu` : le bouton d'origine garde son libellé et son
  CSV, avec « Excel » et « PDF » à côté. Ils sont sur les écrans suivants :
  - clients ;
  - écritures ;
  - approvisionnement ;
  - comptes clients et fournisseurs ;
  - rapports du grand livre ;
  - suivi des livraisons ;
  - réapprovisionnement ;
  - contrôle du plan ;
  - immobilisations ;
  - trésorerie ;
  - stocks.
- La logique est dans `src/lib/table-export.ts` (`exportTable`).

### Actions groupées (`src/components/BulkSelection.tsx`)

La sélection se fait par case à cocher. La barre d'actions agit sur la sélection, une pièce à la
fois, **par les mêmes fonctions contrôlées que le bouton de ligne** : droits, niveaux, séparation
des tâches et paramètres s'appliquent à chaque pièce, et les refus sont regroupés dans un message.
La case « tout sélectionner » reste inactive tant que la liste est vide : le parcours 96 a trouvé
qu'on pouvait la cocher pendant le chargement, sans effet.

| Module | Actions groupées |
|---|---|
| Demandes et commandes d'achat | Exporter, Soumettre, Approuver le niveau en cours, Annuler (motif), Supprimer |
| Factures fournisseurs | Exporter, Soumettre, Approuver le niveau en cours, Supprimer |
| Écritures | Imprimer le brouillard (PDF / Excel), Contre-passer (écritures manuelles comptabilisées, motif) |
| Mouvements de stock | Bon de mouvements (PDF / Excel), Exporter |
| Mouvements de trésorerie | Ordre de virement / bordereau (PDF / Excel), Exporter |
| Déjà présentes | Contacts et opportunités CRM, ventes, factures clients, clients, plan comptable, immobilisations, budget, salariés |

Les statuts et les en-têtes des listes d'achat sont désormais en français (« Approuvée », « En
approbation », « Reçue partiellement »…).

## 3. Écarts restants (classés)

1. **Écrans encore alimentés par des données de démonstration** dans le cœur (lot 3 du plan) :
   - Rapports et paramètres d'approvisionnement (catégories, imputations) ; circuit d'approbation
     du tableau de bord.
   - Contrôle et paramètres du grand livre (types de journaux, périodes : le calendrier central
     V33 existe).
   - Contrôle de la trésorerie.
   - Onglets restants des paramètres des immobilisations.
2. **Plan d'amortissement prévisionnel** : la fiche imprime les dotations comptabilisées. La
   projection des mois futurs devrait venir d'une fonction de la base (même calcul que
   `asset_depreciation_amount`), pas du navigateur.
3. **Édition officielle** (lot 6) : modèles de pièces versionnés par société, logo, PDF produit
   par le serveur, archivage, facture électronique certifiée. Ce lot imprime ce que l'écran montre.
4. **Actions groupées encore absentes** :
   - réceptions (validation groupée) ;
   - approbations RH ;
   - notes de frais, projets, conformité et risques (modules à construire, lot 4).
5. **Modules hors cœur** à construire un par un avec la même méthode (lot 4) : notes de frais,
   projets, conformité, risques.
6. **Taux légaux pré-remplis par `seed_ap_defaults`** (retenues 7,5 / 15 / 20 / 10 %, comptes
   4471–4474) : contraire à la règle « aucun taux légal pré-rempli », à reprendre avec la revue AP.

## 4. Vérification

- Vitest : 101 fichiers, 597 tests.
  - Nouveaux tests : `document-export.test.ts` couvre la pièce Excel, `pdfSafe`, les dates et les
    devises.
  - Test du bulletin mis à jour.
  - `pdf-export.test.ts` attend maintenant l'espace imprimable.
- Lint : 0 erreur. Les deux `tsc` passent, ainsi que `api:check` et `db:check-twins`.
- Parcours nuage : 38 tests verts.
  - Parcours 20, 30, 92 et 93 adaptés : colonne de sélection et statuts en français.
  - Nouveau parcours **96** : sélection et barre d'actions en achats et AP, commande et facture
    imprimées en PDF et Excel, brouillard, bon de stock, bordereau de trésorerie, PDF d'une liste.
    Les fichiers sont vérifiés par leur signature (`%PDF`, ZIP).
- Aucune migration dans ce lot : base et API inchangées.
