# QUOREICH — Revue des processus métier contre les références

Date : 14 novembre 2026. Base : les parcours de bout en bout connectés (`npm run test:e2e:parcours`, 7/7, aucun refus serveur ni erreur navigateur) exécutés sur le projet Supabase, société de test « E2E QUOREICH », et la lecture du schéma (copie `qerp_reel`, V36).

Références : SAP (cycle achat → paiement ME51N / ME21N / MIGO / MIRO / F110, vente → encaissement VA21 / VA01 / VL01N / VF01 / F-28), Sage X3 et Sage 100 (pièces en en-tête / lignes / pied, règlements par tiers, lettrage), AUDCIF OHADA (pièce justificative, intangibilité des écritures validées, clôture).

Légende : ✅ conforme et prouvé par un parcours · 🟡 présent mais incomplet · ❌ absent.

## 1. Achat → paiement (procure-to-pay)

| Étape | Référence | QUOREICH | État |
|---|---|---|---|
| Demande d'achat | ME51N : demandeur, lignes article / quantité / coût estimé | Une seule ligne, saisie par un libellé et un montant | 🟡 |
| Approbation de la demande | Libération par un approbateur habilité | Bouton « Approve » : tout membre peut approuver, y compris sa propre demande | 🟡 |
| Conversion en commande | ME21N avec référence à la demande, lignes reprises | V35 : lignes reprises, numéro de commande par séquence, fournisseur vérifié | ✅ |
| Commande directe | En-tête + lignes article / quantité / prix, conditions du fournisseur | Une seule ligne de quantité 1 ; le total est saisi à la main | 🟡 |
| Approbation de la commande | Stratégie de libération selon les seuils | Pas de seuil ; tout membre peut approuver | 🟡 |
| Réception (MIGO) | Fournisseur → ses commandes → quantités par ligne ; sur-réception refusée ; écriture stock / GR-IR | Fournisseur d'abord, puis seulement ses commandes ; restant par ligne ; sur-réception refusée ; stock compté une fois au coût (V34) ; **aucune écriture comptable** | 🟡 |
| Facture fournisseur (MIRO) | Fournisseur → sa commande ; lignes ; montant de contrôle ; rapprochement prix / quantité ; blocage hors tolérance | Fournisseur → seulement ses commandes (V36, également contrôlé en base) ; **en-tête seul**, sans lignes, sans montant de contrôle ni rapprochement | 🟡 |
| Comptabilisation de la facture | Charge + TVA déductible / fournisseur | **Corrigé par V37** : rôles PURCHASES / VAT_INPUT / AP_PAYABLE, approbation refusée (QG001) si le paramétrage manque ; prouvé par le parcours (601 / 4452 / 401). Historique : script de rattrapage en simulation | ✅ |
| Approbation (bon à payer) | Tiers habilité, séparation des tâches | Paiement impossible avant approbation (prouvé) ; mais l'approbation n'est qu'une colonne modifiable par tous | 🟡 |
| Paiement (F-53 / F110) | Fournisseur → SES postes ouverts → imputation, lettrage | V36 : fournisseur d'abord, seules ses factures approuvées et ouvertes, répartition par échéance, tout ou rien, contrôle en base ; écriture fournisseur / banque datée du paiement (V34) | ✅ |
| Paiement en double | Contrôle des doublons | Non (pas de clé d'idempotence) | ❌ |
| Facture fournisseur en double | Contrôle fournisseur + référence | Non | ❌ |
| Avoir fournisseur, retour | Pièces de régularisation | Absents | ❌ |

## 2. Vente → encaissement (order-to-cash)

| Étape | Référence | QUOREICH | État |
|---|---|---|---|
| Devis → commande → livraison | VA21 → VA01 → VL01N | Écrans présents ; liens `quotation_id`, `so_id`, `ar_invoice_id` en base ; **pas encore couverts par un parcours** | 🟡 |
| Contrôle du plafond de crédit | Blocage à la commande | `check_customer_credit_on_so`, à la commande seulement | 🟡 |
| Facture client | En-tête / lignes / pied, TVA par ligne, numéro définitif à l'émission | Prouvé : 2 lignes avec remise, pied calculé à 168 000, numéro `INV-2026-000x` | ✅ |
| Lien avec la commande | Facture issue de la livraison | La base n'accepte qu'une commande **du même client** (V36) ; l'écran ne la propose pas encore | 🟡 |
| Comptabilisation | Client / ventes / TVA collectée | Écriture équilibrée, datée de la facture (prouvé : 411 / 701) | ✅ |
| Encaissement (F-28) | Client → SES postes ouverts → lettrage | V36 : client d'abord ; seules ses factures ; présélection depuis la facture ; répartition ; plus d'encaissement possible sur une facture soldée (prouvé) | ✅ |
| Acompte, paiement non imputé | Saisie « en compte » | Refusé (le règlement doit être entièrement imputé) | ❌ |
| Avoir client | Pièce d'annulation / régularisation | Absent | ❌ |
| Relances | Niveaux de relance | Paramètres (`ar_dunning_rules`) sans traitement de relance | 🟡 |

## 3. Données de base des tiers

| Point | Référence | QUOREICH | État |
|---|---|---|---|
| Création, recherche, modification | — | Prouvé, fournisseur et client | ✅ |
| Conditions de paiement → échéance | L'échéance découle des conditions du tiers | Champ `payment_terms` présent, mais l'échéance est fixée par défaut à 30 jours | 🟡 |
| Identifiants fiscaux (IFU, RCCM) | Obligatoires sur la facture (OHADA, droit fiscal local) | Un seul champ `tax_id`, facultatif | 🟡 |
| Coordonnées bancaires du fournisseur | Nécessaires au virement | Absentes | ❌ |

## 4. Transversal

| Point | État |
|---|---|
| Cohérence tiers → pièces (règlements, réception, commande d'origine) — demandée par le propriétaire | ✅ écran **et** base (V36) |
| Séparation des tâches (saisisseur ≠ approbateur ≠ payeur) | ❌ |
| Écran Achats et écran Fournisseurs en anglais (« New PO », « Approve », « Pay ») | 🟡 |
| Exercice affiché « AF 2025–2026 » dans l'en-tête alors que la société n'en a aucun | 🟡 |
| Nom « ComptaFlow » sur l'écran d'accueil | 🟡 |

## Écarts classés et rattachement au plan du Lot 3

1. ~~Critique — la facture fournisseur ne passe aucune écriture~~ → **corrigé (V37, 14 nov. 2026)** ; reste le rattrapage de l'historique, à décider avec l'expert-comptable.
2. **Critique — approbation et paiement ouverts à tous, sans séparation des tâches.** → Étape 2.
3. **Haute — facture fournisseur sans lignes, sans montant de contrôle ni rapprochement à trois voies.** → Étape 4.
4. **Haute — doublons de factures et de paiements non contrôlés.** → Étape 4.
5. **Haute — aucune écriture à la réception (compte d'attente « factures non parvenues »).** → Étape 3.
6. **Moyenne — formulaires de demande et de commande à une seule ligne et total saisi.** → À traiter avec l'étape 4 (en-tête / lignes / pied).
7. **Moyenne — avoirs client et fournisseur, acomptes et paiements non imputés absents.** → À planifier (Lot 3 bis).
8. **Moyenne — échéance qui ignore les conditions du tiers ; coordonnées bancaires et identifiants fiscaux.** → Données de base, étape 4.
9. **Faible — libellés anglais, exercice affiché, nom ComptaFlow.** → Lot à part (interface).

## 5. Pièces : en-tête, lignes, pied — impression et export (vérifié le 14 novembre 2026)

| Pièce | Saisie (en-tête / lignes / pied) | Vue de détail | Export de la liste | Impression de la pièce |
|---|---|---|---|---|
| Demande d'achat | ✅ grille de lignes, pied calculé (corrigé : une seule ligne et un total saisi) | ✅ « Voir » | ✅ | Lot 6 |
| Commande fournisseur | ✅ idem (corrigé) | ✅ commandé, reçu, reste à recevoir | ✅ | Lot 6 |
| Réception | ✅ fournisseur → commande → lignes ; pied quantité et valeur (ajouté) | ✅ | ✅ | Lot 6 |
| Facture client | ✅ (V21) | ✅ lignes, pied, écriture comptable (ajouté ; avant : résumé sans lignes) | ✅ | Lot 6 |
| Facture fournisseur | 🟡 en-tête seul → Lot 3 étape 4 | ✅ en-tête et pied ; lignes à l'étape 4 | ✅ (ajouté ; le bouton ne faisait rien) | Lot 6 |
| Règlement (client, fournisseur) | ✅ tiers, ses pièces, répartition, pied imputé / reste (V36) | — | via les factures | Lot 6 |
| Écritures, balance, résultat, bilan, SIG | — | ✅ | ✅ (ajouté : 5 boutons sans action) | Lot 6 |

**Impression officielle des pièces** (modèles versionnés, rendu PDF côté serveur, PDF archivé, sécurité des modèles) : **Lot 6 — Documents et report management** du plan de bascule ; non refaite ici, comme convenu.

**Écrans des lots 2 et 3 encore alimentés par des données de démonstration codées en dur** — à remplacer par les données réelles au Lot 3 (ajouté à son plan, étape 8) : Achats → Données de base (contrats et SLA), Rapports (dépenses par catégorie, délais, principaux fournisseurs), Paramètres (schéma de comptabilisation) et le circuit d'approbation affiché ; Grand livre → Contrôle (anomalies, rapprochements, contrôles d'intégrité, piste d'audit), Transactions (écritures manuelles, automatiques, récurrentes), Paramètres (journaux, périodes) ; Paramètres généraux → plan comptable, conditions de paiement, simulation, historique et délégations du workflow, journal d'audit ; AR → Rapports (modèles et rapports planifiés).

## 6. Nuage et sur site (vérifié le 14 novembre 2026)

| Chemin | Parcours | Résultat |
|---|---|---|
| Nuage : front → Supabase | `npm run test:e2e:parcours` — 9 parcours (tiers, achats, réceptions, fournisseurs, clients, comptabilité, exports) | 9 réussis depuis V37 ; aucune erreur serveur ni navigateur |
| Sur site : front → API Java → PostgreSQL local | `npm run test:e2e:sur-site` — client, facture à lignes, détail, encaissement, export | réussi ; vérifié en base : la donnée est dans la base locale et **absente** de Supabase |

Constats sur site :
- **Corrigé** : les clients étaient lus et créés dans Supabase même en mode sur site, alors que les factures allaient dans la base locale. L'API expose désormais `POST` / `PUT /api/v1/customers` et la fiche complète.
- **Périmètre** : seuls les clients, la facturation et les encaissements AR, le paramétrage comptable, l'analytique et les autorisations passent par l'API. Fournisseurs, achats, stocks et grand livre écrivent encore dans Supabase : ils seront portés aux Lots 3 à 5. D'ici là, un déploiement sur site complet n'est pas possible ; le parcours sur site vérifie qu'aucune écriture de SON périmètre ne part vers le nuage.
- **Identité** : l'API valide les jetons du projet Supabase (ES256). Il faut déclarer `SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_JWS_ALGORITHMS=ES256` : par défaut, Spring n'accepte que RS256. Keycloak sur site reste à faire (plan de bascule).
