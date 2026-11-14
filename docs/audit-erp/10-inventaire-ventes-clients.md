# 10 — Inventaire des modules Ventes et Comptes clients (14 novembre 2026)

Demande du propriétaire : parcourir toutes les fonctionnalités des deux modules et vérifier, partout
où il en faut, un CRUD complet et des actions groupées. Légende : ✅ fait et couvert par un test ·
🟢 fait · ➖ sans objet (lecture seule par nature) · 🟡 reste à faire.

## Commandes de vente (`/sales`)

| Écran | Créer | Lire (détail, export, impression) | Modifier | Supprimer / annuler | Actions groupées |
|---|---|---|---|---|---|
| Devis | ✅ lignes, remise, TVA (V43) | ✅ clic → en-tête / lignes / pied, CSV, PDF A4 | ✅ tant qu'aucune ligne n'est commandée (V46) | ✅ idem (V46) | 🟢 exporter, supprimer la sélection |
| Commandes | ✅ libre ou depuis les lignes d'un devis du client (V44) | ✅ idem | ✅ commande libre en brouillon (V46) ; reprise d'un devis : supprimer puis recréer | ✅ brouillon sans livraison, quantités rendues au devis (V46) | 🟢 exporter, confirmer (contrôle de crédit pour chacune), supprimer |
| Livraisons | ✅ depuis la commande, ligne à ligne | ✅ idem | ➖ une livraison validée a déjà sorti le stock | ✅ retour client (V50) : pièce de retour, ré-entrée en stock, avoir lié | 🟢 exporter, facturer la sélection (factures brouillon) |
| Données de base | ➖ lecture : clients (encours, limite), articles vendables, conditions | ✅ listes | 🟢 lien « Gérer » vers l'écran propriétaire de chaque donnée (fiches clients, Stocks → articles, Comptes clients → conditions) | — | — |
| Rapports, Contrôle, Tableau de bord | ➖ vues calculées (pipeline, délais, audit) | ✅ exports existants | — | — | — |
| Paramètres | — | — | 🟢 réglages et séries de numérotation (administrateur, V40) | — | — |

## Comptes clients (`/receivables`, `/customers`)

| Écran | Créer | Lire | Modifier | Supprimer / annuler | Actions groupées |
|---|---|---|---|---|---|
| Fiches clients | ✅ (V48 : rôles habilités) | ✅ recherche, export | ✅ | ✅ comptable / administrateur ; fiche citée par une pièce : message clair, la désactiver | ✅ exporter la sélection ; 🟢 désactiver / réactiver |
| Factures | ✅ lignes, TVA, échéance selon les conditions du client | ✅ panneau en-tête / lignes / pied / écriture, CSV, PDF | ✅ brouillon (codes TVA, émission) ; émise : figée (V42) | ✅ brouillon ; émise : par avoir (V45) | 🟢 exporter la sélection, émettre ou supprimer les brouillons sélectionnés |
| Encaissements | ✅ par client, répartition (V36) | ✅ règlements de la facture | ➖ figés | ✅ annulation par contre-passation motivée (V42) | ✅ un encaissement couvre plusieurs factures du client |
| Avoirs | ✅ total ou partiel par ligne (V45) | ✅ liste, vue, PDF | ➖ figés | ➖ (un avoir ne s'annule pas) | — |
| Relevé de compte | — | ✅ période, solde d'ouverture, solde progressif, PDF | — | — | — |
| Analyse d'âge, Rapports | ➖ | ✅ ; modèles de rapport réels (`report_templates`) | ✅ modèles | ✅ modèles | — |
| Contrôle | ➖ exposition crédit, journal des notifications, périodes (calendrier central V33) | ✅ | — | — | — |
| Paramètres | ✅ conditions, relances, notifications, séries | ✅ | ✅ | ✅ suppression ajoutée (V48 : comptable / administrateur ; un terme utilisé par des pièces est refusé avec message) | — |

## Défauts trouvés et corrigés pendant l'inventaire

| # | Constat | Correction |
|---|---|---|
| 1 | Fiches clients, conditions de paiement, relances et notifications : écriture ouverte à tout membre (même « Lecteur ») | V48 : lecture pour tous ; écriture réservée aux rôles habilités |
| 2 | Factures : une sélection par cases à cocher existait sans aucune action | Barre d'actions (export, émettre / supprimer les brouillons) |
| 3 | Ventes : aucune action groupée | Barres d'actions sur devis, commandes, livraisons |
| 4 | Données de base des ventes en lecture seule sans indiquer où gérer les données | Liens vers l'écran propriétaire |
| 5 | Paramètres AR : impossible de supprimer un terme, un niveau de relance, une règle | Suppression avec confirmation et contrôle des droits |
| 6 | Rapports AR : rapports planifiés et matrice des permissions inventés | Remplacés par « non disponible » et un lien vers les autorisations réelles |
| 7 | Suppression d'un client cité par des pièces : message SQL brut | Message : désactiver la fiche |

## Reste à faire (ventes et clients)

- ~~Retour client sur livraison~~ : fait en V50.
- ~~Acomptes clients et lettrage~~ : faits en V49 (acompte, imputation, remboursement, lettrage automatique).
- Listes de prix par client, remises par client.
- Actions groupées sur site (API) : statut des fiches clients.
- Relances exécutées (les niveaux existent, aucun traitement ne les applique).
