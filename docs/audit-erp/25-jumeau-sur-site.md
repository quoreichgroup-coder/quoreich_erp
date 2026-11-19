# 25 — Jumeau sur site : API Java pour tous les modules

Démarré le 19 novembre 2026. Ce document est tenu à jour à chaque module porté.

## 1. Décision

Le propriétaire a tranché :

- **chaque module a son API Java** ;
- **le nuage garde Supabase** ;
- **l'installation sur site tourne sur la pile Java + PostgreSQL locale**, sans dépendre d'aucun
  service Supabase.

La passerelle de données générique (PostgREST sur site) a été écartée.

## 2. État de départ

Seuls les points suivants passaient par l'API :
- clients, factures et encaissements clients, avoirs clients ;
- paramétrage comptable, codes TVA, analytique ;
- autorisations ;
- une partie de la paie.

Le front comptait environ **600 accès directs à Supabase** dans 80 fichiers, plus :
- la connexion (9 appels à Supabase Auth) ;
- le stockage de fichiers (justificatifs de notes de frais) ;
- le temps réel.

## 3. Méthode

Le plan de bascule s'applique : Java appelle d'abord les fonctions SQL existantes, puis les absorbe
domaine par domaine.

**Socle commun `com.quoreich.qerp.platform`**

- **`Sql`** : lectures, écritures et appels de fonctions sur la source de données de l'application.
  Le contexte société et la RLS sont posés sur chaque connexion, si bien que les droits, gardes et
  refus sont ceux du chemin Supabase.
  - Les résultats sont sérialisés par PostgreSQL (`to_jsonb`). Ils ont la forme exacte des réponses
    PostgREST, et l'écran lit la même chose dans les deux déploiements.
  - Écritures : seules les **colonnes autorisées** par le module sont écrites. `tenant_id` est
    toujours posé par le serveur. Les colonnes imposées (auteur, statut initial, type de paiement)
    sont des expressions du module, jamais du client.
  - Zéro ligne touchée est un refus explicite (403), comme le contrôle « touched » du chemin Supabase.
  - Fonctions : appel en notation nommée, chaque argument typé par le catalogue.
  - Aucun identifiant SQL ne vient du client.
- **`DatabaseRefusalAdvice`** : les refus rédigés par la base sont rendus avec leur message.
  - `QGxxx`, `RAISE` et contraintes → 422 ;
  - droit 42501 → 403 ;
  - unicité ou référence → 409 ;
  - le reste est générique (500) et journalisé.
- Une écriture en plusieurs étapes est **une transaction** (service `@Transactional`). Par exemple,
  une facture à lignes avec ses sections analytiques : un refus n'en laisse rien, là où le chemin
  Supabase devait supprimer l'en-tête à la main.

**Modules `com.quoreich.qerp.modules.<domaine>`** : contrôleurs explicites (route, SQL, colonnes
autorisées, fonction appelée), contrat OpenAPI figé, tests d'intégration sur PostgreSQL réel.

**Front** : chaque hook garde son chemin Supabase et gagne une branche
`if (isApiEnabled()) return apiGet/apiPost/…`.

## 4. Définition de « porté »

Pour chaque module :

1. Points d'accès Java pour toutes les lectures et écritures de ses écrans.
2. Test d'intégration HTTP. Il couvre :
   - la société posée par le serveur ;
   - le refus d'un rôle insuffisant ;
   - l'invisibilité depuis une autre société ;
   - le cycle de vie par les fonctions.
3. Contrat OpenAPI et types TypeScript régénérés.
4. **Parcours sur site du module** : il échoue si un seul accès de son périmètre, **lecture
   comprise**, part vers Supabase.

Second membre sur site : `scripts/e2e/approbateur-sur-site.sql` (même identifiant que dans le nuage),
session enregistrée par `tests/e2e/sur-site/01-approbateur.spec.ts`.

Constat en cours de route : dès que la société vient de la base locale (`/me`), tout écran qui lit
encore Supabase avec cet identifiant échoue visiblement (406, 0 ligne). Les parcours le détectent ;
c'est ce qui a imposé de porter la coquille avec les premiers modules.

**Les parcours du nuage sont rejoués sur site tels quels** (projet `parcours-sur-site` de
`playwright.sur-site.config.ts`, `npm run test:e2e:sur-site`) : société locale, sessions locales, et
tout accès aux données de Supabase (hors connexion) compté comme incident par `surveiller()` (type
`acces-nuage`). La liste des parcours rejoués (`PARCOURS_PORTES`) s'étend à chaque module porté ;
`E2E_PARCOURS_SUR_SITE=<regex>` la remplace pour un essai. État au 19 novembre 2026 : 21 parcours du
nuage verts sur site (10, 20, 30, 50, 80, 90, 92, 93, 94), plus les 4 parcours propres au sur site.

Les refus de l'API portent leur code SQLSTATE (`{"code": "QG007", "error": "…"}`), comme les réponses
de Supabase : les refus métier annoncés par les parcours (`refusAttendu(/QG007.*/)`) sont reconnus
dans les deux déploiements.

Fin du chantier :
- tous les parcours métier rejoués sur site ;
- connexion locale (fournisseur d'identité sur site) ;
- stockage de fichiers local ;
- temps réel remplacé.

## 5. Avancement

| Module | API Java | Front | Test | Parcours sur site |
|---|---|---|---|---|
| Socle (`Sql`, refus, analytique des pièces, seuils d'approbation) | ✅ | ✅ | `PayableApiIT` | — |
| Comptes fournisseurs (fournisseurs, factures à lignes, approbations, paiements, règlements, avoirs, retours, paramètres AP) | ✅ | ✅ | `PayableApiIT` | ✅ `20-fournisseurs-sur-site` |
| Clients, facturation client, avoirs clients (lot 2) | ✅ | ✅ | existants | ✅ `10-clients-sur-site` |
| Approvisionnement (demandes, commandes, réceptions en une transaction, approbations, conversion, suivi des livraisons, rapprochement, réapprovisionnement, rapports, paramètres) | ✅ | ✅ | `ProcurementApiIT` | ✅ `30-achats-sur-site` (avec le second membre) |
| Grand livre (comptes, écritures en une transaction, balance, grand livre, périodes, lots, audit, contrôles, états), plans comptables (référentiels, qualité, import, correspondances, migration, audit, jeux de comptes) | ✅ | ✅ | `LedgerApiIT` | ✅ nuage 50 rejoué |
| Ventes (devis, commandes, livraisons, retours, vues, paramètres, numérotation) | ✅ | ✅ | `TreasuryBudgetSalesApiIT` | à rejouer avec le CRM (nuage 60) |
| Stocks (articles, entrepôts, mouvements, inventaires, campagnes) | à faire | | | |
| Trésorerie (comptes, mouvements, virements, relevés, rapprochement, prévisions, clôture, limites, audit) | ✅ | ✅ | `TreasuryBudgetSalesApiIT` | ✅ nuage 80 rejoué |
| Immobilisations | à faire | | | |
| Budget (budgets, lignes, cycle, révisions, scénarios, contrôle, prévisions, paramètres) | ✅ | ✅ | `TreasuryBudgetSalesApiIT` | ✅ nuage 90, 92, 93, 94 rejoués |
| Notes de frais, projets | à faire | | | |
| CRM | à faire | | | |
| RH et paie (reste) | partiel | | | |
| Conformité, risques | à faire | | | |
| Coquille : profil et société (`/me`), société courante, modules actifs, alertes, préférences de notification, calendrier fiscal | ✅ | ✅ | `ProcurementApiIT` (`/me`) | via tous les parcours sur site |
| Pilotage (tableaux de bord, CFO, IA), administration (sociétés, modules, invitations, import) | à faire | | | |
| Identité sur site (connexion sans Supabase Auth) | à faire | | | |
| Fichiers (justificatifs) et temps réel | à faire | | | |
