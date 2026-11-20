# 28 — Bilan : lots du plan, écarts de l'analyse ERP, standard des modules

État au 19 novembre 2026, vérifié dans le code et dans les bases (sur site `qerp_reel` et nuage), pas seulement dans les
documents. Références : `docs/PLAN-BASCULE-JAVA.md` §6 (lots), `02-analyse-des-ecarts.md` (G-01 à G-51),
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
| 6 | **Documents et report management** : modèles versionnés, éditeur, rendu isolé, **PDF archivé** | ⚠️ partiel : impression navigateur (`printDocumentPDF`) | Modèles versionnés par société, rendu côté serveur, archivage du PDF émis, sécurité des modèles (DOC-TPL-06) |
| 7 | **Application mobile** (Android, consultation et validation) | ❌ non commencé | Tout |

## 2. Écarts de l'analyse ERP (02)

**Traités (37, dont G-04 par V120)** : G-01 à G-03, G-05 à G-20, G-23, G-24, G-26 (impression), G-33, G-36 (balayage 27), G-37, G-38, G-39 (API Java
pour tous les modules), G-40 (traduction), G-42 à G-45, G-51 (paramétrage), G-28 en partie (moteur de paie et tests).

**Restants (13)** — G-22 traité le 20 nov. 2026 par V121 (modèle « report sans écritures d'à-nouveaux » choisi par le propriétaire) ; — G-04 traité le 20 nov. 2026 par V120 (chaîne SHA-256 vérifiable, journal intangible) :

| # | Écart | Prio | Note |
|---|---|---|---|
| G-21 | États financiers complets : tableau des flux de trésorerie (TFT) et notes annexes | P1 🧮 | Bilan et compte de résultat par rubriques faits (V63) ; TFT cadré (17) |
| G-25 | Multi-devise : factures, commandes, règlements en devise, taux, écarts de change | P1 | Aucune colonne de devise sur les factures |
| G-27 | ROXGOLD SANGO : reclassement 4000 → 70x, 4310 → 443x | P1 🧮 | Décision de l'expert-comptable (D4) |
| G-28 | Paie : validation métier / fiscale par pays | P1 🧮 | Taux et comptes par pays (D5) |
| G-29 | Demandes de prix et comparatif fournisseurs | P2 | |
| G-30 | Réception de services (sans stock) | P2 | |
| G-31 | Retenues à la source appliquées au règlement fournisseur | P2 🧮 | Taux saisis mais jamais appliqués |
| G-32 | Relances clients exécutées (envoi, historique) | P2 | Règles saisies, aucun traitement ; dépend de la messagerie |
| G-34 | Réservation de stock à la commande | P2 | Projection seulement |
| G-35 | Pièces jointes sur toutes les pièces | P2 | Seuls les justificatifs de notes de frais |
| G-41 | Tests de concurrence et idempotence (double clic, deux onglets) | P3 | |
| G-46–G-48 | Achats internationaux : devises, avance fournisseur, dossier d'import, frais d'approche, douane UEMOA, en-cours de route (lots I1–I3) | P1 importateurs | Décisions déjà prises (mémoire « Règles achats internationaux ») |
| G-49, G-50 | Lots / séries / péremption ; contrats-cadres et évaluation fournisseurs | P3 | |

## 3. Standard de présentation des modules

- **Menus** : les 15 modules suivent le standard (`standard()`, test `navigation.test.ts` vert).
- **Pages** : les 6 pages de chaque module ont le cadre, le fil d'Ariane et le bandeau d'aide. Corrigé le 20 nov. 2026 :
  `/customers` (ancienne mise en page) et `/suppliers` (sans bandeau) au standard ; `/projects/transactions` a ses onglets
  « Suivi du projet | Comptabilisation » (`?tab=posting`), ce dernier expliquant que le projet comptabilise par sa section analytique.
- **UX-10** (budget, conformité, risques à revoir) : menus conformes ; à confirmer à l'écran avec le propriétaire.

## 4. Ordre proposé

1. Standard des modules : `/customers`, `/suppliers`, onglets de `/projects/transactions` (court).
2. G-04 : chaînage SHA-256 vérifiable de la piste d'audit (sécurité, P0).
3. Hébergement VPS (lot 1, point 7) : compose de production, TLS, sauvegardes hors site, restauration testée.
4. G-22 puis G-21 : clôture d'exercice avec à-nouveaux, puis TFT et annexes (avec l'expert-comptable).
5. G-25 / I1–I3 : multi-devise et achats internationaux.
6. Lot 6 : modèles de documents versionnés, PDF archivé.
7. P2 (G-29 à G-35), puis lot 7 (mobile) et P3.
