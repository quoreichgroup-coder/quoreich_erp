# QERP — Spécification du Proof of Concept i18n

## 1. Objet

Prouver sur un parcours vertical court, hors production, que l'architecture validée (D-I18N-001 à 010) tient :
bascule FR / EN sans perte, préférences résolues par le serveur, formats régionaux sans altération des valeurs,
refus métier traduits avec repli sûr, facture émise en anglais figée, isolation entre sociétés, contrôle CI,
retour arrière non destructif.

## 2. Périmètre retenu (après vérification du flux réel)

| Zone | Fichiers | Remarque |
|---|---|---|
| Coquille | `TopNav`, `DashboardSidebar` (135 entrées de menu), `CommandPalette`, `NotificationBell`, `AppearanceSettings`, `PageShell` | traduite partout |
| Connexion | `Login`, `AuthShell` | sélecteur avant connexion, sans requête |
| Profil et société | `Settings` (onglets), `LanguageSettingsPanel`, `LanguageSwitcher` | onglet `/settings?tab=languages` |
| Ventes | `Sales` (tableau de bord), `CommercialLinesEditor` / `CommercialTotals` | éditeur partagé avec AR / AP |
| Documents | `DocumentEditions` + `use-document-editions`, V155, deux moteurs de rendu | facture client |
| Refus métier | QG001 émission de facture et compte manquant ; QG038 / QG039 nouveaux | chemins Java (AR lot 2 + modules) et Supabase |

**Écart documenté** : le parcours devis → commande → livraison → facture passe par `SalesTransactions.tsx`
(≈ 155 textes) ; il n'est pas traduit dans le PoC. Le sous-parcours retenu va du tableau de bord Ventes à
l'édition PDF de la facture, et l'écran des transactions affiche l'avertissement « pas encore disponible en anglais ».

## 3. Hors périmètre

Généralisation aux 115 pages, aux ≈ 4 900 textes et aux 1 204 messages SQL ; LMC complet ; traduction IA ; RTL ;
nouvelles langues ; mobile ; déploiement cloud de V155 ; envoi d'e-mail réel.

## 4. Environnement

Données synthétiques uniquement : bases PostgreSQL 18.6 jetables (Testcontainers et conteneurs détruits après
usage), backend simulé pour Playwright, Gotenberg local en réseau interne. Aucune écriture sur Supabase ni sur la
base `qerp_reel`.

## 5. Lots

| Lot | Contenu | Statut |
|---|---|---|
| POC-00 | Baseline git, build, tests, mesure d'entrée | fait |
| POC-01 | i18next, 7 namespaces FR / EN, `lang` / `dir`, repli | fait |
| POC-02 | V155 : référentiels, préférences, langues autorisées, RLS, droit | fait |
| POC-03 | `locale-format.ts`, `useLocaleFormat`, devise de la société | fait |
| POC-04 | Coquille, connexion, réglages, ventes traduits | fait |
| POC-05 | Contrat d'erreur Java + Supabase, 2 refus existants convertis | fait |
| POC-06 | Facture EN, langue figée, refus sans modèle, rendu réel, historique | fait (chaîne complète API → archive non jouée) |
| POC-07 | Tests, CI, mesures, documentation, retour arrière | fait |

## 6. Critères

Voir `QERP_I18N_ACCEPTANCE_CRITERIA.md` (AC01 à AC11) et leur résultat dans `QERP_I18N_POC_EXECUTION_REPORT.md`.
