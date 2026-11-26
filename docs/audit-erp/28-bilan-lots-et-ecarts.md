# 28 — Bilan : lots du plan, écarts de l'analyse ERP, standard des modules

Actualisation au 20 novembre 2026 : état des implémentations vérifié dans le code et les migrations ; nuage vérifié à V140
(124 empreintes, parcours 104–106). Les constats historiques des autres rapports ne valent pas un nouvel état de recette.
Références : `docs/PLAN-BASCULE-JAVA.md` §6 (lots), `02-analyse-des-ecarts.md` (G-01 à G-51),
`09-feuille-de-route.md`, `06-plan-ui-ux.md`, règle « standard de présentation des modules ».

## 1. Lots du plan de bascule

| Lot | Contenu prévu | État | Ce qui manque |
|---|---|---|---|
| 0 | Reprise du schéma, parité | ✅ fait (V1–V15, manifeste, recette d'isolation) | — |
| 1 | Socle Java, identité, multi-société, OpenAPI, santé, CI, compose, **premier déploiement VPS** | ✅ sauf le déploiement | Identité : faite par l'API (V114, DEC-07) au lieu de Keycloak. **Compose de production et mise en service sur le VPS : non faits** |
| 1bis | Découpe du bundle, cache, charte, montées de version | ✅ (virtualisation remplacée par une pagination côté écran, décision documentée) | — |
| 2 | AR de bout en bout (AR-REC) | ✅ | — |
| 3 | AP, GL, achats (AP-REC, GL-REC, ACH-REC) | ✅ fonctionnellement (V34–V41, V60–V72, API Java) | Les critères de recette formels n'ont pas été rejoués un par un ; les parcours en tiennent lieu |
| 4 | Ventes/stocks, trésorerie, immobilisations | ✅ fonctionnellement (V40–V54, V70–V75, V91–V100) | Idem |
| 5 | Modules à construire (budget, projets, dépenses, risques, conformité…) | ✅ (V73–V79, V109–V113) ; aucune page de données statiques (balayage 27) | — |
| 6 | **Documents et report management** : modèles versionnés, éditeur, rendu isolé, **PDF archivé** | ⚠️ D1 implémenté et recetté localement pour la facture client (V141, [cadrage 30](30-documents-modeles-et-archives.md)) | API Java → Gotenberg → archive → réimpression et remplacement immuable passés sur la base E2E locale ; hôte de rendu cloud, mise en service et autres pièces DOC-TPL-01 restent à faire |
| 7 | **Application mobile** (Android, consultation et validation) | ❌ non commencé | Tout |

## 2. Écarts de l'analyse ERP (02)

**Socle livré** : G-01 à G-20 (G-04 complété par V120), G-23, G-24, G-33, G-36 à G-40, G-42 à G-45 et G-51.
Les lignes ci-dessous distinguent les fonctions désormais implémentées des restes métier, techniques ou d'exploitation.
L'impression navigateur de G-26 ne constitue pas encore le lot 6 complet.

**États et clôture** : G-21 implémenté par V122 (tableau des flux) et V123 (notes annexes), avec validation comptable encore
requise ; G-22 implémenté par V121 selon le modèle « report sans écritures d'à-nouveaux » choisi par le propriétaire.

**Écarts encore suivis** :

| # | Écart | Prio | Note |
|---|---|---|---|
| G-25 | Multi-devise : factures, commandes, règlements en devise, taux, écarts de change | P1 | Implémenté (V124–V130) : devises, avances, écarts et réévaluation ; import BCEAO fourni par V130 (tâche Java / fonction nuage). Activation et suivi du planificateur à vérifier selon l'hébergement |
| G-26 | Édition officielle des pièces | P1 | V141 : modèles versionnés et archives immuables de factures clients implémentés localement ; impression navigateur séparée. API Java → Gotenberg et parcours 107 validés. Reste l’hôte de rendu cloud et les autres pièces DOC-TPL-01 |
| G-27 | ROXGOLD SANGO : reclassement 4000 → 70x, 4310 → 443x | P1 🧮 | Décision de l'expert-comptable (D4) |
| G-28 | Paie : validation métier / fiscale par pays | P1 🧮 | Taux et comptes par pays (D5) |
| G-29 | Demandes de prix et comparatif fournisseurs | P2 | **Fait (V139)** : consultation, offres en devise, comparatif au cours du jour, attribution motivée par une autre personne, commandes créées |
| G-30 | Réception de services (sans stock) | P2 | **Fait (V140)** : articles stockés / non stockés / services, réception par avancement sans stock, service fait par un tiers paramétrable, valorisation en facture non parvenue conservée ; services exclus des inventaires et du réapprovisionnement |
| G-31 | Retenues à la source appliquées au règlement fournisseur | P2 🧮 | **Fait (V136)** : catégorie par fournisseur, retenue figée à l'approbation, prélevée au paiement (401 / banque nette / 447x), état des retenues ; taux à saisir selon la loi fiscale |
| G-32 | Relances clients exécutées (envoi, historique) | P2 | **Partiel (V142 + V145 déployées)** : aperçu et envoi manuel SMTP sur site et dans la fonction Edge, prochaine règle courriel, journal idempotent (une relance par facture/règle), contenu figé et état incertain sans réémission. La sonde cloud utilise TLS 465 et n’envoie aucun message. Déploiement de la fonction Edge, secrets SMTP, recette d’authentification et retest d’idempotence restent à faire. Lettres/appels et planification restent manuels. |
| G-34 | Réservation de stock à la commande | P2 | Projection seulement |
| G-35 | Pièces jointes sur toutes les pièces | P2 | **Fait (V138)** : pièces jointes sur toutes les pièces, typées, archivées (suppression tracée), exigence paramétrable avant soumission |
| G-41 | Tests de concurrence et idempotence (double clic, deux onglets) | P3 | Couverture partielle (inventaires, réception de services notamment) ; matrice transverse de tous les traitements encore à compléter |
| G-46–G-48 | Achats internationaux : devises, coûts et transit | P1 importateurs | I1–I3 implémentés (V124–V135) : 381 / 311, consolidation, transit, événements, alertes, réception du dossier et coût de revient. Connecteur prestataire prêt (V134) ; choix du prestataire et abonnement restent à configurer ([29](29-processus-import-sans-excel.md)) |
| G-49, G-50 | Lots / séries / péremption ; contrats-cadres et évaluation fournisseurs | P3 | |

## 3. Standard de présentation des modules

- **Menus** : les 15 modules suivent le standard (`standard()`, test `navigation.test.ts` vert).
- **Pages** : les 6 pages de chaque module ont le cadre, le fil d'Ariane et le bandeau d'aide. Corrigé le 20 nov. 2026 :
  `/customers` (ancienne mise en page) et `/suppliers` (sans bandeau) au standard ; `/projects/transactions` a ses onglets
  « Suivi du projet | Comptabilisation » (`?tab=posting`), ce dernier expliquant que le projet comptabilise par sa section analytique.
- **UX-10** (budget, conformité, risques à revoir) : menus conformes ; à confirmer à l'écran avec le propriétaire.

## 4. Ordre proposé

1. **Lot 6 D1, exploitation nuage** : le parcours local complet, la migration V141, la conversion PDF/A et la préservation des archives sont validés ; configurer TLS, sauvegardes et hôte du renderer pour le nuage.
2. **Infrastructure de production** : VPS, TLS, sauvegardes hors site et restauration testée ; raccorder le rendu nuage à un hôte configuré.
3. **G-32, V142 + V145** : schéma cloud et endpoint Edge préparés; V144–V145 sont appliquées sur le projet propriétaire. Déployer la fonction et ses secrets, puis vérifier l’authentification avant toute relance réelle. La planification et les lettres/appels restent à traiter.
4. **G-34** : réservation ferme du stock à la commande (la projection seule ne la remplace pas).
5. **Lot 6, suites** : mêmes preuves pour achats, stocks, factures fournisseurs et clôture de trésorerie.
6. **Validations métier en parallèle** : décisions comptables D4 / D5 et validation des états financiers.
7. **Lot 7 et P3** : mobile, lots / séries / péremption, contrats-cadres, matrice transverse de concurrence.
