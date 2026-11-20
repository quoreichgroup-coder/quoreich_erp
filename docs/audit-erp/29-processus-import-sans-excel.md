# 29 — Processus des commandes internationales : de la procédure Sage 300 à un flux sans fichier Excel

Source : procédure interne « PROCESSUS COMMANDES INTERNATIONNALES » (Sage 300 ERP, `docs/TEMPLATES/`, 16 pages), demande
du propriétaire (20 nov. 2026) : analyser, comparer aux ERP modernes, améliorer, **supprimer la manipulation de fichiers
Excel**. Migrations V129 à V133.

## 1. La procédure Sage 300 et ses points de friction

| Étape Sage 300 | Ce qui est manuel | Remplacé dans QUOREICH par |
|---|---|---|
| Bon de commande fournisseur étranger | Onglet Taxes à vider, classe de taxe « 2 » à forcer | Facture et commande en devise sans code TVA ; TVA à l'importation estimée sur la valeur CAF (V124, V129) |
| Réception dans le magasin de consolidation | Changer l'emplacement à la main ; vérifier l'onglet Totaux pour que réception = facture | Dépôt de réception choisi (type « consolidation ») ; stock en **381** (marchandises en cours de route) ; rapprochement à 3 voies existant (V41, V72) |
| Numéro d'expédition unique ANNÉE-TRANSITAIRE-MODE-NNN | Construit à la main, séquence tenue de mémoire | Généré à l'ouverture du dossier selon le format de la société (`{YYYY}-{FWD}-{MODE}-{SEQ3}`), séquence continue (V132) |
| Bon de commande de transport | Copie d'un ancien BC, description « Shipment : n° », champs optionnels ETA / ETAT / SHIPNO saisis | « Créer la commande de transport » : BC brouillon au transitaire, une ligne par frais (réel, sinon estimé), « Shipment : n° », rattaché au dossier ; ETA / état / numéro sont des champs du dossier (V132) |
| Transfert de transit (TRF) | Rapport d'extraction, export Excel, nettoyage de 3 feuilles (`#REF!`), script XML d'import, comptabilisation | **Un clic** « Expédier » (consolidation → transit) puis « Arrivée au dépôt » (transit → destination) ; quantités calculées par le dossier ; reclassement 381 → 311 à l'arrivée ; option : déclenché par les événements réels « départ » et « livré » (V132) |
| Suivi | Champ ETAT saisi | Chronologie automatique (commande, accusé du fournisseur, réceptions) + événements DCSA, import du fichier de suivi du transitaire, retard mesuré contre l'ETA initiale (V131, V133) |

## 2. Ce que font les ERP modernes, et ce qui a été repris

- **Microsoft Dynamics 365 — Landed cost** : un « voyage » regroupe commandes et conteneurs ; frais **estimés** dès la
  création par des règles automatiques (« auto costs »), remplacés par les réels à l'arrivée des factures, rapport
  estimé / réel ; dépôt « marchandises en transit » associé à chaque dépôt ; les dates réelles de chaque étape mettent les
  estimations à jour. → Règles de frais estimés (pourcentage de la valeur ou forfait, par type de frais, mode de
  transport, fournisseur), comparaison estimé / réel, dépôt de transit, étapes datées.
  [Landed cost overview](https://learn.microsoft.com/en-us/dynamics365/supply-chain/landed-cost/landed-cost-overview),
  [Manage voyages](https://learn.microsoft.com/en-us/dynamics365/supply-chain/landed-cost/manage-voyages),
  [Estimate and manage landed costs](https://learn.microsoft.com/en-us/dynamics365/supply-chain/landed-cost/estimate-manage-landed-costs).
- **SAP S/4HANA — transfert en deux temps** : sortie puis entrée, stock « en transit » suivi entre les deux, sans document
  intermédiaire. → Expédition et arrivée séparées, stock en transit visible (« Marchandises en consolidation ou en
  transit »).
  [Stock transfers between plants](https://learning.sap.com/courses/inventory-management-and-physical-inventory-in-sap-s-4hana/performing-stock-transfers-between-plants).
- **NetSuite — Inbound Shipment** : une expédition regroupe des lignes de plusieurs commandes ; frais répartis sur toute
  l'expédition ou sur des lignes. → Dossier multi-commandes, base de répartition par frais.
  [Using Inbound Shipment Management](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1490823161.html).
- **Odoo** : réception en deux étapes, frais d'approche par réception, modèles de frais.
  [Landed costs](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/landed_costs.html).
- **DCSA Track & Trace** (compagnies maritimes) et plateformes multi-transporteurs (suivi par connaissement ou
  conteneur) : événements observés à une date et un lieu. → Référentiel d'étapes, prévu / estimé / réel.
  [DCSA Track & Trace](https://dcsa.org/standards/track-and-trace).

## 3. Choix comptables (décision D-I4, `11` §7)

- Stock reçu dans un dépôt de consolidation ou de transit : débit **381** / crédit 6031 (inventaire permanent).
- Arrivée dans un dépôt de la société : reclassement débit **311** / crédit **381** au coût moyen.
- Transfert entre deux dépôts de même nature : aucune écriture.
- Frais d'approche réels répartis : coût moyen relevé, 311 / 6031 pour la part en stock (V129). Les estimations ne se
  répartissent pas (pas de réévaluation a posteriori).

## 4. Restes et pistes

- **Suivi automatique par un prestataire** : connecteur générique prêt (V134) — adresse de réception propre à la société,
  événements au format DCSA rattachés par connaissement ou conteneur, clé API en écriture seule. Reste à choisir le
  prestataire (Terminal49, Vizion, ShipsGo, SeaRates : service payant) et, si besoin, son adaptateur d'abonnement.
- **Réception par expédition** (NetSuite) : une réception unique pour toutes les commandes du dossier.
- **Lecture automatique des factures du transitaire** (OCR / IA, comme Odoo) pour créer les frais réels.
- Rapport de coût par voyage (estimé, réel, écart, coût de revient unitaire par article).
