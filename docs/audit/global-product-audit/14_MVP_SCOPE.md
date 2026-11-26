# 14 — Périmètre MVP et versions du produit

> Phase 5. Proposition à valider (G0). Objectif MVP : une **entreprise pilote burkinabè** exécute ses processus financiers
> complets (commande → facture → règlement → comptabilité → états SYSCOHADA) dans un environnement contrôlé.
> Efforts en ordre de grandeur (S ≤ 1 semaine, M 2–4 semaines, L > 1 mois), à confirmer.

## 1. Classement MoSCoW

### MUST HAVE

| Fonctionnalité | État | Reste à faire | Effort | Acceptation |
|---|---|---|---|---|
| Comptabilité générale, journaux, périodes, clôture, états SYSCOHADA, TFT, notes | TESTED | Validation des états par un expert-comptable ; G-27 | M (externe) | Balance et états d'un exercice réel identiques à ceux du cabinet |
| Ventes et clients (devis → facture → encaissement, avoirs, lettrage) | TESTED | Rejouer les parcours ; impression officielle cloud (lot 6) | S–M | Parcours 40 / 60 verts + facture imprimée conforme |
| Achats et fournisseurs (demande → commande → réception → facture → règlement) | TESTED | Délégation d'approbation (absence) | M | Parcours 20 / 30 verts + scénario d'absence |
| Trésorerie (comptes, règlements, relevés, rapprochement) | TESTED | Formats de relevés des banques du pilote | S | Rapprochement d'un mois réel |
| Stocks de base | TESTED | — | — | Parcours 70 / 71 |
| Administration : sociétés, utilisateurs, droits, invitations, isolation | TESTED | AUD-01 (droits de consultation) ; MFA administrateurs | M | Tests d'isolation verts ; revue des rôles du pilote |
| Import des données de départ (plan, tiers, articles, soldes d'ouverture) | Partiel | Procédure de reprise des soldes testée | M | Reprise d'un client réel en recette |
| Exports et réversibilité | TESTED (exports par écran) | Export complet de la société | S–M | Export complet rechargeable |
| **Exploitation** : environnement de production + recette, TLS, sauvegarde et restauration testées, supervision | INEXISTANT | Tout (voir 12) | L | Restauration chronométrée ; RPO / RTO fixés (DEC-08) |
| Sécurité d'exposition : limitation de débit, durcissement AUD-02, en-têtes HTTP | Partiel | Voir 06 | S–M | Revue de sécurité sans écart élevé |
| Documentation utilisateur des processus MUST + formation du pilote | INEXISTANT | Rédaction | M | Utilisateurs du pilote autonomes |

### SHOULD HAVE
Budget et contrôle budgétaire ; immobilisations ; notes de frais ; paie **une fois les barèmes Burkina Faso saisis et validés
avec leur source** et un mois comparé à un bulletin de cabinet ; relances clients (déploiement SMTP) ; multi-devise.

### COULD HAVE
CRM, projets, conformité et risques, dossiers d'import / frais d'approche, demandes de prix, analyses IA **désactivées par
défaut** (AUD-04).

### MODULES EN APERÇU (« en développement ») — décision du propriétaire du 26/11/2026 (AUD-05)

Inclus dans le MVP avec un **périmètre réduit**, affichés avec la mention « en développement », activables par société
(`tenant_modules`), **hors engagement de service** tant qu'ils n'ont pas leur propre recette. Ils ne doivent jamais écrire en
comptabilité ni en stock autrement que par les fonctions existantes (règles, droits et isolation inchangés).

| Module | Périmètre réduit proposé | Réutilise | Prérequis | Effort | Acceptation |
|---|---|---|---|---|---|
| **Application mobile** | Boîte d'approbations (achats, factures, notes de frais, congés) ; libre-service RH (demande de congé, solde) ; note de frais avec photo du justificatif ; consultation du cockpit | API Java / PostgREST, identité compatible supabase-js, fonctions d'approbation existantes | DEC-09 (recommandation : React Native + Expo, Android d'abord) ; prototypes V1–V5 ; file d'approbations transverse côté serveur | L | Un approbateur valide une commande depuis son téléphone ; la même règle de séparation des tâches s'applique |
| **IA (petite partie)** | Gouvernance d'abord : activation par société (désactivée par défaut) et droit du catalogue, données minimisées, journal complet ; puis les 2 analyses existantes (prévision de trésorerie, anomalies d'écritures) | `ai_analysis_history`, planificateur V117 | AUD-04 | M | Une société sans activation n'envoie aucune donnée ; chaque appel est journalisé |
| **Maintenance** | Registre des équipements (lien optionnel à l'immobilisation) ; demandes et ordres de travail correctifs ; consommation de pièces du stock ; temps passé ; coût imputé en analytique ; historique par équipement ; préventif simple par calendrier | Immobilisations, stocks, temps (V152), analytique, pièces jointes, numérotation | Spécification EAM (non fournie) ; validation par un responsable maintenance | L | Un OT consomme une pièce (mouvement de stock) et son coût apparaît sur la section de l'équipement |
| **Arrêts (downtime)** | Déclaration d'arrêt sur un équipement (début / fin, planifié / non planifié, cause et sous-cause paramétrables) ; contrôle des chevauchements et doublons ; validation ; indicateurs MTTR, MTBF, disponibilité, Pareto des causes | Équipements (ci-dessus) | **D-01 / D-02 / D-03 à fournir et statuer** ; définitions ISO 14224 à valider | M–L | Deux arrêts qui se chevauchent sur un même équipement sont refusés ; MTTR recalculé à la main sur un échantillon |
| **Production** | Nomenclature simple ; ordre de fabrication (consommation des composants, entrée du produit fini en stock, coût de revient) | Stocks (mouvements contrôlés, CMUP), analytique | Préciser le besoin du pilote (voir note) | L | Un OF clôturé sort les composants, entre le produit fini au coût calculé, écriture 311 / 6031 en inventaire permanent |

Note : si « Maintenance Production » désignait la maintenance des équipements de production (et non un module de
fabrication), la ligne « Production » sort du MVP et la maintenance la couvre.

**Effet sur la date du MVP** : ces cinq chantiers s'ajoutent au chemin critique ; ils peuvent avancer en parallèle de
l'exploitation, mais la maintenance et les arrêts dépendent de spécifications non fournies.

### WON'T HAVE FOR NOW
Flotte, agents IA qui agissent sur les données, internationalisation, déclarations fiscales télétransmises (à reconsidérer
selon la réglementation et le pilote), préventif conditionnel / prédictif, OEE complet.

## 2. Versions du produit

| Version | Périmètre | Critères de sortie |
|---|---|---|
| **MVP** | MUST HAVE ci-dessus | Score MVP ≥ 75 % ; zéro P0 ouverte ; parcours MUST verts ; isolation vérifiée ; restauration testée ; états validés par un expert-comptable |
| **Pilot Release** | MVP + SHOULD HAVE choisis avec 1 à 3 pilotes | ≥ 85 % ; support et procédure d'incident opérationnels ; recette signée par chaque pilote ; 1 clôture mensuelle réelle réussie |
| **Stable Commercial Release** | Pilot + COULD HAVE validés | ≥ 90 % ; pentest sans écart élevé ; documentation et formation ; SLA, contrats, licences ; installation reproductible chez plusieurs clients |
| **Enterprise Release** | Organisations complexes, volumes, gouvernance (délégation, workflow transverse, MFA, SSO, i18n) | ≥ 95 % ; tests de charge ; PRA testé ; audit externe |
| **Business AI Hub** | Gouvernance IA puis assistants en lecture, puis brouillons validés par l'humain | Activation par société ; journal complet ; jeux d'évaluation par module |

## 3. Chemin critique vers le MVP

1. Exploitation (VPS ou nuage dédié, recette, sauvegarde / restauration) — **le plus long et le plus bloquant**.
2. Validation expert-comptable des états et du modèle de clôture.
3. Durcissement sécurité (AUD-02, limitation de débit, MFA administrateurs) et AUD-01.
4. Délégation d'approbation.
5. Documentation utilisateur, reprise de données, recette avec le pilote.
6. En parallèle : spécifications maintenance / arrêts (et D-01..D-03), DEC-09 (mobile), gouvernance IA (AUD-04), puis
   construction des modules en aperçu.
