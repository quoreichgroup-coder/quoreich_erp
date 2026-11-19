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
`E2E_PARCOURS_SUR_SITE=<regex>` la remplace pour un essai. État au 19 novembre 2026 : **tous les parcours métier
du nuage sont verts sur site** (46 tests dans 29 fichiers, dont les 4 parcours propres au sur site ; 21 min). Les
parcours à trois chiffres forment une seconde passe (`parcours-sur-site-suite`) : ils utilisent le salarié du
parcours 95.

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
| Clients, facturation client, avoirs clients (lot 2) ; complément : paramètres AR, brouillons, encaissements, acomptes et crédits, lettrage, relevé, jeux de comptes des fiches, identité de la société, modèles de rapports | ✅ | ✅ | existants, `StocksCrmAssetsApiIT` | ✅ `10-clients-sur-site`, nuage 40 rejoué |
| Approvisionnement (demandes, commandes, réceptions en une transaction, approbations, conversion, suivi des livraisons, rapprochement, réapprovisionnement, rapports, paramètres) | ✅ | ✅ | `ProcurementApiIT` | ✅ `30-achats-sur-site` (avec le second membre) |
| Grand livre (comptes, écritures en une transaction, balance, grand livre, périodes, lots, audit, contrôles, états), plans comptables (référentiels, qualité, import, correspondances, migration, audit, jeux de comptes) | ✅ | ✅ | `LedgerApiIT` | ✅ nuage 50 rejoué |
| Ventes (devis, commandes, livraisons, retours, vues, paramètres, numérotation) | ✅ | ✅ | `TreasuryBudgetSalesApiIT` | ✅ nuage 60 rejoué |
| Stocks (articles, entrepôts, mouvements, inventaires, campagnes, cycles, clôtures, vues, paramètres) | ✅ | ✅ | `StocksCrmAssetsApiIT` | ✅ nuage 70, 71 rejoués |
| Trésorerie (comptes, mouvements, virements, relevés, rapprochement, prévisions, clôture, limites, audit) | ✅ | ✅ | `TreasuryBudgetSalesApiIT` | ✅ nuage 80 rejoué |
| Immobilisations (catégories, fiches, amortissements, cessions, paramètres) | ✅ | ✅ | `StocksCrmAssetsApiIT` | ✅ nuage 91 rejoué |
| Budget (budgets, lignes, cycle, révisions, scénarios, contrôle, prévisions, paramètres) | ✅ | ✅ | `TreasuryBudgetSalesApiIT` | ✅ nuage 90, 92, 93, 94 rejoués |
| Notes de frais (brouillon en une transaction, cycle, catégories, barèmes, avances, justificatifs stockés sur le serveur), projets | ✅ | ✅ | `ExpensesProjectsGrcApiIT` | ✅ nuage 99, 100 rejoués |
| CRM (contacts, import, actions groupées, opportunités, activités, conversion en devis) | ✅ | ✅ | `StocksCrmAssetsApiIT` | ✅ nuage 60, 61 rejoués |
| RH et paie (API du 17–18 nov.) | ✅ | ✅ | `HrApiIT` | ✅ nuage 95 rejoué |
| Conformité, risques | ✅ | ✅ | `ExpensesProjectsGrcApiIT` | ✅ nuage 101 rejoué |
| Coquille : profil et société (`/me`), société courante, modules actifs, alertes, préférences de notification, calendrier fiscal | ✅ | ✅ | `ProcurementApiIT` (`/me`) | via tous les parcours sur site |
| Pilotage (tableau de bord, cockpit CFO, échus, consolidation par liste fermée), administration (modules, licences, règles de flux, invitations, création / rattachement de société), import en masse (jumeau de `import-data`), analyses IA (jumeaux des deux fonctions, fournisseur compatible OpenAI `QERP_AI_*`, historique, planifications) | ✅ | ✅ | `PilotageAdminApiIT` | ✅ parcours 102 (nuage et sur site) |
| Exécution planifiée des analyses IA sur site (le nuage passe par `ai-scheduler` et pg_cron) | à faire | | | |
| Identité sur site (connexion sans Supabase Auth) | à faire | | | |
| Fichiers (justificatifs) | ✅ répertoire `qerp.files.dir` (défaut `./data/files`), mêmes règles que le stockage du nuage | ✅ | `ExpensesProjectsGrcApiIT` | ✅ |
| Temps réel | à faire (sur site : rafraîchissement React Query) | | | |

**Défauts du nuage trouvés en portant le cockpit CFO (19 nov. 2026)** : la requête lisait `bank_accounts.current_balance`,
`risk_register.severity` et `payroll_runs.total_net`, trois colonnes qui n'existent pas ; les erreurs étaient ignorées, si bien que la
trésorerie, les risques élevés et la paie du mois affichaient 0. Le calcul est désormais une fonction pure (`computeCfoCockpit`, testée) :
trésorerie = soldes calculés des comptes actifs, risques élevés = score net au-delà du seuil « élevé » de la société, paie = `net_total`
des cycles comptabilisés payés dans le mois ; une lecture en erreur remonte au lieu de donner 0.

**Restes connus** : la création d'une société sur site suppose que le profil existe déjà dans la base locale (le provisionnement du profil
viendra avec l'identité sur site) ; les règles de flux (`workflow_rules`) restent modifiables par tout membre (point ouvert du lot 4).
