# 11 — Stocks, achats et achats internationaux : comparaison aux références et proposition de lots

Demande du propriétaire (14 nov. 2026) : vérifier comment les applications de référence gèrent le
réapprovisionnement, les inventaires, les achats et les **commandes externes / internationales**,
analyser l'existant de QUOREICH, et proposer une suite de lots intégrée à cet audit.

Références : SAP S/4HANA (MM, MRP, EWM, inventaire physique, coûts d'acquisition / *landed cost*,
commerce extérieur), Sage X3 (réapprovisionnement, inventaires tournants, frais d'approche, dossiers
d'importation), Sage 300 (I/C, P/O, *additional costs*), Microsoft Dynamics 365 SCM (planification,
*landed cost*), Odoo (règles de réapprovisionnement min / max, achats, *landed costs*), cadre
OHADA / SYSCOHADA révisé et règles douanières UEMOA / CEDEAO. Les taux et comptes marqués 🧮 sont à
valider par l'expert-comptable et le transitaire avant tout paramétrage.

## 1. Constat de l'existant (base `qerp_reel` à V53, écrans du 14 nov. 2026)

| Domaine | Ce qui existe | État |
|---|---|---|
| Sécurité des stocks | Mouvements, couches de valorisation, articles, dépôts, comptages : plus d'écriture directe ; tout passe par les pièces ou des fonctions habilitées (V53) | ✅ `StocksSecurisationIT`, parcours 70 |
| Comptabilisation du stock | Inventaire permanent 311 / 6031 par rôles, intermittent au choix (V51) | ✅ |
| Écrans Stocks | Transactions (mouvements réels, ajustement motivé, transfert) et Données de base (articles, dépôts) réels depuis V53 ; tableau de bord, rapports et contrôle à revoir | 🟡 |
| Seuils | `items.reorder_level`, `safety_stock`, `max_stock` **globaux à l'article** (pas par dépôt) ; vue `low_stock_alerts_view` | 🔴 la vue prend le **stock de sécurité à la place du point de commande** quand il est renseigné : l'alerte arrive trop tard |
| Proposition de réapprovisionnement | Aucune : l'alerte ne crée ni demande ni commande | ⚪ |
| Stock par dépôt | `item_locations` (quantité par dépôt) tenu par `apply_stock_movement` ; les seuils et l'inventaire raisonnent sur le stock global | 🟡 |
| Inventaire physique | Comptage → validation ; depuis V53 l'attendu est recalculé à la validation et valorisé au coût moyen | 🟡 pas de gel du stock à l'ouverture, pas de comptage à l'aveugle, pas de tolérance ni de recomptage, pas d'inventaire tournant |
| Classement ABC | Vues `abc_analysis_view`, `inventory_abc_view` | 🟢 non relié aux inventaires tournants |
| Lots, numéros de série, péremption | Aucun | ⚪ |
| Unités | Une seule unité par article, aucune conversion (achat en carton, stock en unité) | ⚪ |
| Achats | Demande → commande → réception → facture, approbations par niveaux, séparation des tâches, rapprochement à 3 voies, retours et avoirs (V39–V52) | ✅ |
| Fiche fournisseur | Nom, contacts, IFU, conditions de paiement ; pas de RIB, pas de devise, pas de catalogue article / prix / délai | 🟡 (G-33) |
| Demande de prix (RFQ), comparatif, contrats-cadres | Aucun | ⚪ (G-29) |
| Date de livraison prévue, relance fournisseur | Aucune date prévue sur la commande ni la ligne | ⚪ |
| Évaluation fournisseurs | KPI de délais de traitement internes (SLA) seulement | ⚪ |
| Devises | Colonne `currency` sur sociétés, comptes bancaires, opportunités ; **commandes, factures fournisseurs et règlements sans devise ni taux** | ⚪ |
| Importation | Ni Incoterm, ni dossier d'import, ni frais d'approche, ni marchandises en cours de route, ni droits de douane | ⚪ |

## 2. Réapprovisionnement

**Références.** Toutes calculent un besoin **par article et par dépôt** :

- *Point de commande* (SAP « VM », Odoo « min / max », Sage X3 « seuil de réapprovisionnement ») :
  quand le stock disponible prévisionnel (stock + commandes fournisseurs en cours − réservations
  clients) passe sous le **point de commande**, on propose une quantité pour remonter au **maximum**
  (ou une quantité économique / un multiple du minimum de commande du fournisseur).
- Point de commande = consommation moyenne × délai fournisseur + stock de sécurité. Le stock de
  sécurité n'est **pas** le seuil d'alerte, c'est un coussin en dessous de lui.
- *Planification des besoins* (MRP de SAP, plan de réapprovisionnement Sage X3, Dynamics) : besoins
  issus des commandes clients et prévisions, sur un horizon, avec délais.
- Les propositions sont **revues** par l'acheteur puis converties en demandes d'achat ou en commandes
  regroupées par fournisseur préféré.

**Écarts QUOREICH :** seuils globaux, alerte fausse (stock de sécurité pris pour le seuil), aucun
délai fournisseur, aucun fournisseur préféré, aucune quantité minimale de commande, aucune
proposition, stock disponible ignorant les commandes en cours et les réservations clients (G-34).

**Proposition (lot R1, « Réapprovisionnement »)**
1. `item_replenishment_rules` par article × dépôt : méthode (point de commande / min-max / manuel),
   point de commande, stock de sécurité, maximum, multiple et minimum de commande, fournisseur préféré.
2. Catalogue fournisseur `supplier_items` : référence fournisseur, prix, devise, unité d'achat et
   conversion, délai en jours, minimum de commande, validité du prix (base de R1 et de A1).
3. Vue « stock disponible prévisionnel » = en stock + commandé non reçu − commandé client non livré.
4. `generate_replenishment_proposals(dépôt?)` : propositions datées, quantité arrondie au multiple,
   fournisseur préféré ; écran « Propositions de réapprovisionnement » (onglet de Transactions des
   achats) → conversion en **demandes d'achat** groupées par fournisseur (le circuit d'approbation V39
   s'applique tel quel). Planification nocturne possible ensuite (Quartz sur site, cron Supabase).
5. Correction immédiate de l'alerte : seuil = point de commande, stock de sécurité affiché à part.

## 3. Inventaires

**Références.** Inventaire **annuel complet** obligatoire en clôture (AUDCIF : l'inventaire des
existants fonde les comptes annuels) ; **inventaire tournant** (SAP « cycle counting », Sage X3) par
classe ABC (A souvent, C rarement) qui peut le remplacer quand il couvre tout l'exercice 🧮 ;
**document d'inventaire** avec gel : la quantité théorique est figée à l'ouverture, les mouvements
du dépôt sont bloqués ou isolés pendant le comptage ; **comptage à l'aveugle** (le compteur ne voit
pas le théorique) ; **tolérance** par valeur / pourcentage au-delà de laquelle un **recomptage** est
exigé ; **approbation** de l'écart par un tiers ; écriture d'écart datée de l'inventaire.

**Écarts QUOREICH :** pas d'ouverture / gel, comptage non aveugle, pas de tolérance ni de recomptage,
pas d'inventaire par dépôt réel (la validation compare au stock global), pas de programme tournant.

**Proposition (lot S3, « Inventaires »)**
1. Campagne d'inventaire : ouverture (choix dépôt, catégories ou classes ABC), **instantané** de la
   quantité théorique par article × dépôt, mouvements du dépôt refusés tant que la campagne est
   ouverte (option « gel » comme SAP « blocage de comptage »).
2. Saisie à l'aveugle (le théorique n'est pas montré au compteur), recomptage demandé au-delà de la
   tolérance (paramètres de stock : % et montant), approbation de l'écart par `inventory.post_count`,
   jamais par le compteur (séparation des tâches V39).
3. Programme tournant : fréquence par classe ABC, liste du jour générée.
4. Rapport d'inventaire imprimable (feuille de comptage, état des écarts valorisés) pour l'auditeur.

## 4. Achats (domestiques)

**Références.** SAP et Sage X3 : **demande de prix** multi-fournisseurs → **comparatif** → commande ;
**contrats-cadres** (quantité ou montant, prix fixés, appels de livraison) ; **date de livraison
prévue** par ligne, **relances** automatiques (accusé de réception de commande, retard) ;
**évaluation fournisseurs** (délai tenu, conformité, retours, prix) ; envoi de la commande au
fournisseur (PDF, e-mail) ; réception de **services** sans stock (G-30) ; pièces jointes (G-35).

**Proposition (lots A1–A3)**
- **A1 — Fiche fournisseur et suivi de commande** : RIB, devise, Incoterm par défaut, délai, catalogue
  `supplier_items` (partagé avec R1) ; date de livraison prévue par ligne ; accusé de réception
  fournisseur ; liste « commandes en retard » ; impression et envoi de la commande (même moteur que
  les pièces de vente, `printDocumentPDF`).
- **A2 — Demandes de prix et comparatif** (G-29) : RFQ à plusieurs fournisseurs, saisie des offres
  (prix, délai, conditions), comparatif par ligne, attribution → commande (motif obligatoire si l'offre
  retenue n'est pas la moins chère, piste d'audit).
- **A3 — Contrats-cadres et évaluation** : contrat (période, prix, plafond), appels de commande
  imputés sur le contrat, alerte de dépassement ; note fournisseur calculée (délai, retours V52,
  écarts de facture).

## 5. Achats externes et internationaux

**Références et cadre UEMOA / CEDEAO.**

- **Devise** : commande et facture en devise du fournisseur (EUR, USD, CNY…), taux au jour de la
  facture, règlement au taux du jour de paiement ; l'écart va en **perte de change (676)** ou **gain
  de change (776)** 🧮 ; écart latent à la clôture sur les dettes en devise (comptes 478 / 479 ou
  provision) 🧮. L'EUR est à parité fixe avec le XOF (655,957) — utile mais à ne pas coder en dur :
  table de taux datés, source BCEAO.
- **Incoterms 2020** (EXW, FCA, FOB, CFR, CIF, DAP, DDP…) : ils fixent qui paie le fret, l'assurance et
  le dédouanement, et **quand** la marchandise devient la propriété de l'acheteur (transfert des risques).
- **Coût d'acquisition** (SYSCOHADA) : prix d'achat + frais accessoires (transport, assurance, droits
  de douane, transit, manutention) **incorporés au coût du stock** ; SAP « conditions de coût
  d'acquisition », Sage X3 « frais d'approche », Odoo / Dynamics « landed costs » : les frais sont
  saisis (souvent sur les factures du transitaire, du transporteur, de l'assureur, de la douane) puis
  **répartis** sur les lignes de la réception (au prorata de la valeur, du poids, du volume ou de la
  quantité), ce qui révise le coût moyen et la valeur du stock.
- **Marchandises en cours de route** (compte 38 SYSCOHADA) 🧮 : quand la propriété est transférée avant
  l'arrivée (FOB, CIF…), la facture fournisseur précède la réception ; le stock entre en 38, puis passe
  en 31 à la réception.
- **Douane UEMOA** (déclaration en détail, DAU / déclaration IM4) 🧮 : droit de douane du **Tarif
  extérieur commun** (catégories 0, 5, 10, 20, 35 %), redevance statistique (1 %), prélèvement
  communautaire de solidarité UEMOA (1 %), prélèvement communautaire CEDEAO (0,5 %), **TVA à
  l'importation** (taux national, en principe récupérable), plus selon les pays acomptes d'impôt
  (AIB / précompte BIC / AIRSI) et redevances informatiques. Les droits et prélèvements (hors TVA
  récupérable et acomptes d'impôt) entrent dans le coût d'acquisition ; la TVA import va en TVA
  récupérable ; l'acompte d'impôt en créance fiscale.
- **Paiement international** : virement SWIFT, **crédit documentaire** ou remise documentaire
  (banque, date d'échéance, frais bancaires en 631), acompte à la commande (avance fournisseur 409).
- **Suivi logistique** : dossier d'import (n° de dossier, fournisseur, transitaire, connaissement / LTA,
  conteneurs, ETA, port / bureau de douane, déclaration), étapes (commandé, expédié, arrivé, dédouané,
  réceptionné) et pièces jointes.

**Écarts QUOREICH :** tout est absent ; un achat importé ne peut aujourd'hui être saisi qu'en XOF au
prix fournisseur, sans frais : **coût du stock sous-évalué, marge des ventes surévaluée**, droits et
transit passés en charges sans lien avec la marchandise.

**Proposition (lots I1–I3)**
- **I1 — Devises** : table des taux datés (saisie ou import BCEAO), devise et taux sur commande,
  facture fournisseur (contre-valeur XOF figée à la facture) et règlement ; écart de change réalisé
  au règlement par rôles de comptabilisation `FX_LOSS` / `FX_GAIN` (676 / 776) ; avance fournisseur
  (rôle `SUPPLIER_ADVANCE`, 409) ; écran de réévaluation de clôture (proposition d'écriture, validée
  par le comptable).
- **I2 — Dossier d'importation et frais d'approche** : Incoterm sur la commande ; dossier d'import
  regroupant commandes, réceptions et factures de frais (fournisseur, transitaire, transporteur,
  assureur, douane) ; types de frais (fret, assurance, droit de douane, RS, PCS, PC, transit,
  manutention) avec leur compte et leur traitement (incorporé au stock ou non, TVA récupérable) ;
  **répartition** sur les lignes reçues (valeur / poids / quantité) qui révise la couche de
  valorisation et le coût moyen, écriture 311 / 6031 complémentaire en inventaire permanent ; frais
  arrivés après la vente d'une partie du stock → part vendue en coût des ventes (comme SAP / Odoo).
- **I3 — Marchandises en cours de route et suivi logistique** : facture avant réception selon
  l'Incoterm (stock en 38 puis 31), étapes du dossier, ETA et alertes de retard, pièces jointes (G-35).

## 6. Ordre proposé et dépendances

| Lot | Contenu | Dépend de | Priorité |
|---|---|---|---|
| **S1** | Sécurisation des stocks, écrans Transactions / Données de base réels | — | ✅ fait (V53) |
| **S2** | Correction de l'alerte de seuil (point de commande ≠ stock de sécurité), tableau de bord Stocks réel | S1 | P1 (petit) |
| **R1** | Règles de réapprovisionnement par article × dépôt, catalogue fournisseur, stock prévisionnel, propositions → demandes d'achat | S2, A1 (catalogue) | P1 |
| **A1** | Fiche fournisseur complète, date prévue et retards, impression / envoi de la commande | — | P1 |
| **I1** | Devises sur achats, écarts de change, avance fournisseur | A1 | P1 dès qu'une société importe |
| **I2** | Dossier d'import, frais d'approche répartis dans le coût du stock, douane UEMOA | I1, V51 | P1 pour les importateurs |
| **S3** | Campagnes d'inventaire, gel, aveugle, tolérance, tournant ABC | S1 | P2 (P1 avant la première clôture annuelle) |
| **A2** | Demandes de prix et comparatif | A1 | P2 |
| **I3** | En-cours de route (38), suivi logistique | I2 | P2 |
| **A3** | Contrats-cadres, évaluation fournisseurs | A2 | P3 |
| — | Lots / numéros de série / péremption ; unités de conversion | R1 | P2 (selon les clients : pharmacie, agro-alimentaire) |

## 7. Décisions adoptées (propriétaire, 14 nov. 2026 : « règles de la BCEAO et pratique africaine et internationale »)

| # | Question | Règle retenue |
|---|---|---|
| D-S1 | Mode de suivi des stocks | Inventaire **permanent** par défaut pour une nouvelle société (V51) ; intermittent sur demande |
| D-I1 | Taux de change | **BCEAO** : EUR à parité fixe 655,957 XOF ; autres devises au cours de référence publié par la BCEAO, table de taux datés (saisie ou import). Conversion au **cours du jour de l'opération** (facture, règlement) ; écart réalisé au règlement en **676 / 776** ; à la clôture, dettes et créances en devises réévaluées au cours de clôture : perte latente en **478** avec provision pour risque de change, gain latent en **479** sans produit (SYSCOHADA révisé, prudence) |
| D-I2 | Répartition des frais d'approche | **Valeur** par défaut ; fret et assurance au **poids** ou au **volume** quand ils sont saisis sur les lignes (pratique SAP / Sage / Odoo) |
| D-I3 | Comptabilisation des frais d'approche | Factures du transitaire, du transporteur, de l'assureur et de la douane à leur nature en **6015 « frais sur achats »** (droits et prélèvements non récupérables compris) ; **TVA à l'importation en 4452** (récupérable) ; acomptes d'impôt prélevés en douane en créance fiscale ; en inventaire permanent, l'entrée en stock (311 / 6031) est **revalorisée au coût complet** (prix + frais répartis), ce qui donne le coût d'acquisition SYSCOHADA |
| D-I4 | Compte 38 | Utilisé seulement quand l'Incoterm transfère la propriété avant l'arrivée (EXW, FCA, FAS, FOB, CFR, CIF, CPT, CIP) **et** que la facture précède la réception ; soldé en 31 à la réception |
| D-I5 | Douane | Paramètres par pays, en **données** (jamais en code) : catégories du TEC UEMOA (0 / 5 / 10 / 20 / 35 %), redevance statistique 1 %, PCS UEMOA 1 %, PC CEDEAO 0,5 %, TVA import au taux national ; acomptes et redevances propres à chaque pays ajoutés par pays. Premiers pays : **Burkina Faso** et **Côte d'Ivoire** (sociétés existantes), taux à confirmer par le transitaire avant mise en service |
