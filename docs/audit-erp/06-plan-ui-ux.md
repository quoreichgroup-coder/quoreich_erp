# 06 — Plan d'amélioration UI / UX

Base : lecture des 112 pages, parcours Playwright (nuage 13/13, sur site 2/2) qui manipulent réellement les écrans achats, fournisseurs, clients, comptabilité, CRM et ventes. Mesures chiffrées par recherche dans `src/`.

## 1. Constats

| # | Constat | Mesure / exemple | Effet sur l'utilisateur |
|---|---|---|---|
| U-01 | **Données fictives affichées comme réelles** | ~15 pages contiennent des montants codés en dur (BudgetForecast 51, Reports 20, ProcurementReporting 11, GLTransactions 9, GLControl 8…) | L'utilisateur prend des décisions sur des chiffres inventés ; perte de confiance quand il s'en aperçoit |
| U-02 | Langue mélangée | « New PO », « Purchase Orders », « Create Invoice », « Supplier Invoice » ; statuts bruts `pending_approval`, `partially_received` ; ~300 occurrences de « Pending » | Interface perçue comme inachevée ; statuts techniques incompris |
| U-03 | Documents complexes dans des fenêtres modales | Demande, commande, facture AP, réception : modales larges ; `SalesTransactions.tsx` 1 171 lignes | Peu de place pour l'en-tête / lignes / pied ; perte de saisie si on ferme |
| U-04 | Pas d'aperçu avant validation ni d'impression | Aucun PDF de pièce (Lot 6) | Le client ne reçoit pas sa facture depuis l'ERP |
| U-05 | Confirmations hétérogènes | `window.confirm` dans 4 fichiers, `AlertDialog` dans 8 | Comportement et style différents pour la même action (supprimer) |
| U-06 | Navigation entre pièces liées incomplète | La facture AR / AP montre son écriture ; l'écriture ne renvoie pas à sa pièce ; commande → livraisons → factures non navigables | Audit et réponse à un client lents |
| U-07 | Statuts sans composant unique | `StatusBadge` existe, mais chaque page a sa table de libellés | Couleurs et libellés incohérents d'un module à l'autre |
| U-08 | Actions non autorisées visibles puis refusées par le serveur dans les modules non encore passés au cycle de vie (AR, budget, notes de frais) | ex. annulation de facture | Message d'erreur technique au lieu d'un bouton absent |
| U-09 | Points positifs à conserver | Barre latérale par processus métier ; choix du tiers puis de **ses** pièces (V36) ; `DocumentLinesEditor`, `DocumentDetail`, `JournalEntryPreview`, `SettlementDialog` partagés ; boutons d'action selon droits réels (`my_access`) ; « vous êtes l'auteur » | — |

## 2. Principes cibles (repris de la demande et des références)

1. **Modale** pour les opérations rapides (tiers, règlement, rejet motivé) ; **page complète** pour les pièces à lignes (devis, commande, facture, réception), avec URL propre (`/sales/quotations/:id`) — partage de lien, retour arrière, pas de perte de saisie.
2. **Trois zones** sur toute pièce : en-tête (tiers, dates, références, conditions), lignes (`DocumentLinesEditor`), pied calculé en lecture seule (HT, TVA par taux, TTC, acomptes, net à payer, écart de contrôle).
3. **Barre d'actions fixe** en haut de la pièce : action principale selon le statut (Soumettre / Approuver / Émettre / Enregistrer le règlement), actions secondaires dans un menu.
4. **Fil de la pièce** (« document flow » SAP) : Devis → Commande → Livraisons → Factures → Règlements → Écritures, cliquable dans les deux sens.
5. **Aperçu PDF** avant émission, identique au document imprimé.
6. **Une seule boîte de confirmation** (`AlertDialog`) pour les actions irréversibles, avec motif quand la base l'exige.
7. **Messages d'erreur métier** : traduire les codes QG001–QG008 en phrases et pointer le paramètre à corriger (déjà fait pour QG001).

## 3. Plan

| Étape | Contenu | Réutilise | Priorité |
|---|---|---|---|
| UX-1 | Retirer ou étiqueter « non disponible » toutes les données codées en dur (U-01) | `EmptyState` | P1 (va avec la sincérité des chiffres, cf. Lot 1) |
| UX-2 | Table de libellés de statut unique en français + `StatusBadge` partout (U-02, U-07) ; traduction des libellés anglais restants | `StatusBadge` | P2 |
| UX-3 | Composant `DocumentPage` (en-tête / lignes / pied / barre d'actions / fil de la pièce) ; migration de la facture AR puis AP, puis commandes | `DocumentLinesEditor`, `DocumentDetail` | P2 |
| UX-4 | Fil de la pièce et lien retour écriture → pièce (U-06) | `JournalEntryPreview` | P2 |
| UX-5 | `ConfirmDialog` unique, motif optionnel (U-05) | `AlertDialog` | P2 |
| UX-6 | Aperçu et impression des pièces | Lot 6 (avancer la facture client) | P1 |
| UX-7 | Masquer les actions interdites dans AR / budget / notes de frais dès que leur cycle de vie existe en base (U-08) | `useMyAccess` | avec P0/P1 correspondants |
| UX-8 | Accessibilité : rôles de dialogue et libellés de champs (déjà commencé pour les parcours), contraste des badges, navigation clavier des grilles de lignes | — | P3 |
| UX-9 | Responsive : listes en cartes sous 768 px pour la consultation (la saisie de pièces reste sur poste) | — | P3 |

## 4. Règle de présentation des modules (propriétaire, 14 nov. 2026)

Tous les modules suivent la présentation d'Approvisionnement : même menu (**Tableau de bord, Transactions, Données de base, Rapports, Contrôle**, pages propres au module, **Paramètres**), aucune entrée de menu nommée d'après une pièce, **un onglet par type de pièce dans Transactions**, tiers et référentiels dans Données de base. Le menu est imposé par `standard()` et vérifié par `navigation.test.ts`.

| Module | Menu standard | Transactions en onglets par pièce |
|---|---|---|
| Approvisionnement | ✅ | ✅ Demandes, Commandes, Réceptions, Approbations |
| Commandes de vente | ✅ | ✅ Devis, Commandes, Livraisons, Retours |
| Comptes clients | ✅ (depuis le 14 nov. : « Factures et encaissements » → Transactions) | ✅ Factures, Encaissements, Avoirs, Acomptes et crédits, Comptabilisation |
| Stocks | ✅ | ✅ |
| Grand livre | ✅ | ✅ Livres auxiliaires, Manuelles, Contre-passations |
| Trésorerie | ✅ | ✅ |
| Comptes fournisseurs | ✅ (depuis le 14 nov.) | ✅ Factures, Règlements (liste, annulation motivée), Approbations (à approuver, décisions), Comptabilisation |
| CRM | ✅ (Transactions = opportunités, Données de base = contacts) | 🟡 **UX-10** : Opportunités, Activités / rappels |
| RH et paie | ✅ (Données de base = employés) | 🟡 **UX-10** : Saisie, Cycles de paie |
| Notes de frais, Immobilisations, Budget, Projets, Conformité, Risques | ✅ | 🟡 **UX-10** : à revoir module par module |

