# QERP

**QERP** est un ERP web de gestion financière et opérationnelle édité par **QUOREICH GROUP**, destiné notamment aux PME et groupes opérant en zone OHADA. Le produit couvre les cycles clients, fournisseurs, achats, ventes, stocks et comptabilité, avec des modules de trésorerie, budget, immobilisations, projets, CRM, RH et paie.

Le dépôt contient une application React et deux chemins de déploiement : **Supabase dans le nuage**, ou **API Java/Spring Boot et PostgreSQL sur site**. Le même front choisit son chemin par configuration. L'identité locale, le stockage de fichiers et le temps réel disposent d'implémentations sur site.

Ce README décrit le code et les configurations présents au **27 novembre 2026**. La présence d'une fonctionnalité ou d'une migration dans le dépôt ne prouve pas son déploiement dans un environnement. Le [bilan des lots](docs/audit-erp/28-bilan-lots-et-ecarts.md), les recettes et les rapports spécialisés précisent les preuves et les limites. Les versions techniques des manifestes ne constituent pas un numéro de version commerciale de QERP.

## Sommaire

- [Périmètre et état du produit](#perimetre)
- [Stack et prérequis](#stack)
- [Démarrage rapide](#demarrage)
- [Configuration](#configuration)
- [Architecture et arborescence](#architecture)
- [Modules métier](#modules)
- [Authentification, sociétés et droits](#securite)
- [Comptabilité et reporting CFO](#comptabilite)
- [Documents, PDF et relances](#documents)
- [Langues et formats](#i18n)
- [Charte, design system et responsive](#design-system)
- [Commandes et vérifications](#commandes)
- [Migrations et contrats](#migrations)
- [Déploiement et exploitation](#exploitation)
- [Documentation de référence](#documentation)

<a id="perimetre"></a>

## Périmètre et état du produit

Les écrans et traitements sont implémentés progressivement, avec des fonctions PostgreSQL, des contrôles serveur et des parcours de recette. Les configurations comptables, fiscales, sociales et les circuits d'approbation dépendent de la société et de son contexte réglementaire.

- Les audits initiaux sont **historiques** : consulter leurs mises à jour et le code avant de considérer un ancien écart comme encore ouvert ou déjà clos.
- Les états SYSCOHADA, le tableau des flux et les notes annexes ont des implémentations documentées ; leur validation comptable reste nécessaire. Le dépôt ne démontre pas une certification de conformité globale OHADA, IFRS ou réglementaire.
- Les règles de paie, taux, plafonds et retenues doivent être renseignés et validés à partir des sources applicables au pays. Aucun taux légal universel ne peut être déduit de ce README.
- Le rendu documentaire archivé et les relances ont encore des étapes de configuration ou de recette selon l'hébergement. La traduction et l'adaptation responsive restent progressives.
- Le Compose fourni est un environnement **de développement**. Le [bilan d'exploitation](docs/audit-erp/28-bilan-lots-et-ecarts.md) distingue le socle disponible du déploiement de production encore à préparer.
- L'application mobile native figure dans le plan de bascule ; ce dépôt fournit actuellement le client web responsive.

<a id="stack"></a>

## Stack et prérequis

Les sources de version sont [package.json](package.json), [package-lock.json](package-lock.json), [.nvmrc](.nvmrc), le [POM Java](services/api/pom.xml) et le [Compose de développement](infra/compose.dev.yml).

| Couche | Choix présents dans le dépôt |
|---|---|
| Interface | React / React DOM **19.3.1**, TypeScript **5.9.x**, React Router **7.x** |
| Construction et styles | Vite **8.x**, plugin React SWC, Tailwind CSS **4.x**, composants shadcn/Radix |
| Données et formulaires | TanStack Query **5.x**, React Hook Form, Zod, client Supabase **2.x** |
| Graphiques et exports | Recharts, jsPDF / AutoTable, utilitaires CSV et classeurs |
| Traductions | i18next **27.2.9**, react-i18next **18.0.3** |
| API sur site | Java **25**, Spring Boot **4.1.2**, Spring Security, JPA et accès SQL explicites |
| Base sur site | PostgreSQL **18.6**, migrations Flyway **13.12.1** |
| Nuage | Supabase : PostgreSQL, Auth, Storage, Realtime et fonctions Edge |
| PDF archivé | Gotenberg **9.2.0**, isolé dans Docker |
| Vérification | ESLint, TypeScript, Vitest, Testing Library, Playwright ; JUnit, ArchUnit et Testcontainers côté Java |

Pour le front, le manifeste exige **Node.js ≥ 24.14.1** et **npm ≥ 11.20.0**. Le fichier `.nvmrc`, utilisé par la CI, épingle **Node.js 26.13.0** ; privilégier cette version pour reproduire cet environnement.

Pour le serveur lancé hors conteneur, installer un **JDK 25** et positionner `JAVA_HOME`. Le Maven Wrapper du dépôt télécharge Maven **3.10.0** ; le POM impose au minimum Maven **3.9**. Docker avec le plugin Compose est nécessaire au démarrage local conteneurisé et aux tests Java d'intégration. Le premier build peut télécharger les dépendances et images nécessaires.

Les scripts de schéma `.sh` demandent Bash et les outils qu'ils appellent, dont `psql` et les utilitaires PostgreSQL pour les restaurations. Sous Windows, utiliser un environnement Bash adapté pour ces scripts ; les exemples de lancement ci-dessous utilisent PowerShell.

<a id="demarrage"></a>

## Démarrage rapide

Depuis la racine du dépôt :

```powershell
npm ci
```

Si PowerShell bloque `npm.ps1` ou `npx.ps1`, utiliser respectivement `npm.cmd` ou `npx.cmd`.

Choisir ensuite **un mode de données**. Les exemples n'emploient aucune donnée ni aucun identifiant de production.

### Mode sur site : API et base locales

1. Démarrer PostgreSQL et l'API Java :

```powershell
docker compose -f infra/compose.dev.yml up -d --build
docker compose -f infra/compose.dev.yml logs -f api
```

Flyway applique les migrations au démarrage de l'API. Attendre sa disponibilité ; la compilation et la première reconstruction du schéma peuvent être longues. Quitter le suivi des journaux avec `Ctrl+C` ne coupe pas les conteneurs.

2. Dans un autre terminal PowerShell, lancer le front :

```powershell
$env:VITE_QERP_API_URL = 'http://localhost:8090'
$env:PORT = '8081'
npm run dev -- --strictPort
```

Ouvrir **http://localhost:8081**. Le profil Java `dev` autorise cette origine par défaut. `--strictPort` évite de démarrer silencieusement sur un port non autorisé par CORS.

| Service local | Adresse par défaut |
|---|---|
| Front dans cet exemple | `http://localhost:8081` |
| API publiée par Compose | `http://localhost:8090` |
| Sonde de vivacité | `http://localhost:8090/health` |
| Swagger, profil `dev` | `http://localhost:8090/swagger-ui.html` |
| PostgreSQL publié sur l'hôte | `127.0.0.1:55433` |

Le Compose crée la base `qerp`, avec un rôle applicatif distinct du rôle de migration. Les identifiants de ce fichier sont réservés au développement local. La base est conservée dans un volume Docker. Le port PostgreSQL est surchargeable par `QERP_DEV_DB_PORT`, celui de l'API par `QERP_API_PORT`.

Sur une installation neuve, créer un compte depuis l'écran de connexion, puis créer une société ou la rejoindre par invitation. Les référentiels et paramètres métier restent à configurer avant toute comptabilisation. La [reprise des comptes existants](docs/audit-erp/26-identite-sur-site.md) est une procédure distincte ; elle n'est pas nécessaire pour démarrer une société de développement.

Pour arrêter cet environnement en conservant la base :

```powershell
docker compose -f infra/compose.dev.yml down
```

### Mode nuage : Supabase

Utiliser un projet Supabase préparé pour QERP, avec son schéma, ses politiques et ses fonctions. Une base Supabase vide ne suffit pas. L'historique de reprise et le script de déploiement sont décrits dans [Migrations et contrats](#migrations).

```powershell
$env:VITE_QERP_API_URL = ''
$env:VITE_SUPABASE_URL = 'https://votre-projet.supabase.co'
$env:VITE_SUPABASE_PUBLISHABLE_KEY = 'cle-publiable-de-votre-projet'
$env:PORT = '8081'
npm run dev:cloud -- --strictPort
```

Ces valeurs sont des exemples à remplacer. `dev:cloud` sélectionne le mode Vite `cloud` ; il n'installe ni ne déploie le backend. Le projet utilise aussi des fichiers locaux `.env.cloud` selon le poste : ils sont ignorés par Git et ne sont pas fournis par un nouveau clone.

### Lancer l'API avec le JDK du poste

Après configuration des variables de connexion et du rôle de migration, le serveur peut être lancé sans construire son image :

```powershell
cd services/api
.\mvnw.cmd spring-boot:run '-Dspring-boot.run.profiles=dev'
```

Sous Bash, remplacer `.\mvnw.cmd` par `./mvnw`. Hors Compose, l'API écoute sur `8080` par défaut et le datasource vise `localhost:5432` : adapter `SERVER_PORT` et `QERP_DB_URL` au serveur réellement utilisé. Ne pas lancer simultanément deux API sur le même port.

<a id="configuration"></a>

## Configuration

Le front lit ses variables Vite dans [le client de données](src/integrations/supabase/client.ts) et [le client HTTP](src/api/client.ts). Elles sont publiques et doivent être définies avant le lancement ou la construction du front. Redémarrer Vite après une modification ; pour une livraison statique, reconstruire le bundle avec la configuration cible.

| Variable front | Usage |
|---|---|
| `VITE_QERP_API_URL` | URL racine de l'API, sans `/api/v1`. Non vide : données et identité dirigées vers Java. Vide : chemin Supabase. |
| `VITE_SUPABASE_URL` | URL du projet Supabase, nécessaire en mode nuage. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clé publique Supabase, nécessaire en mode nuage. En mode API, le client fournit lui-même sa valeur technique locale. |
| `PORT` | Port du serveur Vite, `8080` par défaut ; `8081` dans le démarrage local ci-dessus. |

Les fichiers `.env`, `.env.*` et les variantes `.local` sont ignorés par Git. Le dépôt ne fournit pas actuellement de `.env.example`. Créer son fichier local si nécessaire à partir des noms ci-dessus. Ne placer aucun mot de passe, clé `service_role`, secret SMTP ou clé de fournisseur d'IA dans une variable `VITE_*`.

La [configuration serveur](services/api/src/main/resources/application.yml) décrit les valeurs par défaut et les profils :

| Variables serveur | Usage |
|---|---|
| `QERP_DB_URL`, `QERP_DB_USER`, `QERP_DB_PASSWORD` | Connexion PostgreSQL du rôle applicatif non propriétaire. |
| `QERP_MIGRATION_DB_URL`, `QERP_MIGRATION_DB_USER`, `QERP_MIGRATION_DB_PASSWORD` | Connexion distincte utilisée par Flyway. L'URL peut reprendre celle du datasource. |
| `SPRING_PROFILES_ACTIVE`, `SERVER_PORT` | Profil `dev` ou `prod`, port d'écoute interne. |
| `QERP_API_CORS_ALLOWED_ORIGINS` | Origines exactes du front autorisées par l'API et le WebSocket. |
| `QERP_IDENTITY_MODE`, `QERP_IDENTITY_ISSUER`, `QERP_IDENTITY_KEY_FILE`, `QERP_IDENTITY_SIGNUP_ENABLED` | Identité locale par défaut ; mode externe facultatif avec configuration JWT Spring correspondante. |
| `QERP_FILES_DIR` | Répertoire privé des fichiers, propriété Spring `qerp.files.dir`, défaut `./data/files`. |
| `QERP_PDF_URL`, `QERP_PDF_AUTHORIZATION`, `QERP_PDF_RENDERER_VERSION` | Moteur de conversion et authentification éventuelle du proxy. URL vide : rendu indisponible, échec visible et relançable. |
| `QERP_SMTP_HOST`, `QERP_SMTP_PORT`, `QERP_SMTP_USERNAME`, `QERP_SMTP_PASSWORD`, `QERP_SMTP_FROM`, `QERP_SMTP_STARTTLS` | Transport serveur des relances manuelles. |
| `QERP_AI_BASE_URL`, `QERP_AI_API_KEY`, `QERP_AI_MODEL` | Fournisseur d'IA compatible OpenAI sur site. Sans configuration, l'analyse est refusée explicitement. |
| `SUPABASE_DB_URL` | Connexion d'administration utilisée par le script de déploiement du schéma nuage, jamais par le front. |

Les fonctions Edge possèdent leur propre configuration serveur ; consulter [leurs diagnostics](supabase/functions/README.md) et les guides documents/relances. Configurer les variables dans le service qui les consomme : une variable définie sur l'hôte n'est transmise à un conteneur que si son lancement la prévoit.

<a id="architecture"></a>

## Architecture et arborescence

```text
Navigateur React
  ├─ mode nuage ─── Supabase Auth / PostgreSQL-RPC / Storage / Realtime / Edge
  └─ mode sur site ─ API Java : identité, API métier, fichiers, WebSocket
                      ├─ PostgreSQL + fonctions SQL + RLS
                      └─ services configurés : PDF, SMTP, fournisseur IA
```

Les hooks de domaine choisissent le chemin via `isApiEnabled()`. Le client `supabase-js` reste utilisé sur site pour son protocole de session, en pointant vers les routes `/auth/v1` de l'API locale. Sa présence dans le bundle ne signifie donc pas que l'installation sur site envoie ses données vers le nuage.

Les règles métier restent en grande partie dans les migrations PostgreSQL : fonctions, déclencheurs, contrôles de périodes, autorisations et comptabilisation. Les contrôleurs Java exposent des opérations explicites et réutilisent ces fonctions ; les écritures composées passent par des transactions. Le [jumeau sur site](docs/audit-erp/25-jumeau-sur-site.md) détaille les domaines et leurs preuves de portage.

```text
src/
  api/                       Client Java, RPC, temps réel, types OpenAPI générés
  components/                Composants métier, navigation et primitives UI
  contexts/                  Authentification et apparence
  hooks/                     Données et actions par domaine
  i18n/                      Initialisation, préférences, catalogues FR/EN
  integrations/supabase/      Client et types du chemin nuage
  lib/                       Calculs, exports, permissions et utilitaires métier
  pages/                     Pages chargées par route
  styles/                    Polices et styles partagés
services/api/
  src/main/java/             API Spring, identité, sociétés et modules
  src/main/resources/        Configuration, droits, migrations Flyway
  src/test/                  Tests Java et intégration PostgreSQL
  openapi/qerp-api.json       Contrat d'API versionné
supabase/
  migrations/                Historique nuage et migrations jumelles
  functions/                 Fonctions Edge et traitements partagés
drizzle/                     Schéma et historique issus du socle initial
infra/                       Compose de développement, PostgreSQL et moteur PDF
scripts/                     Schéma, identité, E2E, i18n et actifs de marque
tests/e2e/                   Tests simulés et parcours connectés
public/                      Actifs statiques, identité QERP et polices locales
docs/                        Audits, recettes, plans et design system
```

<a id="modules"></a>

## Modules métier

Ce tableau décrit les capacités présentes, sans attribuer de statut global « stabilisé ». Les routes et gardes font autorité dans [App.tsx](src/App.tsx) et [module-access.json](services/api/src/main/resources/module-access.json).

| Domaine | Capacités présentes |
|---|---|
| Pilotage | Accueil, cockpit CFO, consolidation des sociétés accessibles, alertes, historique des analyses IA. |
| Clients / AR | Clients, factures à lignes, encaissements, avoirs, acomptes/crédits, lettrage, balance âgée, relevés et relances. |
| Fournisseurs / AP | Fournisseurs, factures à lignes, approbations, paiements, avoirs, avances, retours et retenues paramétrables. |
| Comptabilité générale | Plans et référentiels comptables, jeux de comptes, journaux, écritures, lots, analytique, périodes, balance, grand livre et états. |
| Achats | Demandes, consultations et offres fournisseurs, commandes, réceptions, rapprochement à trois voies et approbations. |
| Achats internationaux | Dossiers d'import, expéditions, transit, frais d'approche, douane et coûts de revient ; connecteur de suivi à configurer. |
| Ventes et CRM | Contacts, opportunités, activités, devis, commandes, livraisons, retours et conversion vers les pièces suivantes. |
| Stocks | Articles stockés, non stockés et services, entrepôts, mouvements, transferts, ajustements, réapprovisionnement et campagnes d'inventaire. |
| Trésorerie | Comptes banque/caisse, mouvements, virements, règlements reliés, relevés, rapprochement, prévisions et clôtures. |
| Immobilisations | Registre, catégories, acquisitions, amortissements, cessions et paramétrage comptable. |
| Budget | Budgets, sections, engagements, réalisé, révisions, scénarios, prévisions et contrôles. |
| Projets et frais | Suivi par section analytique, budget/réalisé/engagé, notes de frais, justificatifs, approbations, avances et remboursements. |
| RH et paie | Salariés, contrats, mouvements datés, rubriques, règles versionnées, variables, prorata, temps/absences/congés, cycles, bulletins et paiement des salaires. |
| Risques et conformité | Registre des risques, évaluations, actions, référentiels de contrôles, tests et constats. |
| Administration | Sociétés, invitations, modules/licences, rôles et droits, calendrier fiscal, règles de workflow, import, modèles et langues. |

Les détails du cycle documentaire et des impacts comptables sont dans [l'audit des processus](docs/audit-erp/README.md). Les améliorations RH/paie V148–V154 et leurs limites figurent dans [l'audit RH/paie actualisé](docs/audit-erp/32-audit-rh-paie.md) ; ne pas confondre leur présence dans le code avec leur application à une base existante.

<a id="securite"></a>

## Authentification, sociétés et droits

- En mode nuage, l'authentification utilise Supabase Auth. Sur site, l'API émet et vérifie ses propres sessions en mode `local`, avec renouvellement et révocation ; le mode `external` est une autre configuration possible.
- Un compte sans société passe par l'onboarding : création ou rattachement par code d'invitation. `useTenantId` lit le profil de la source active, via `/api/v1/me` sur site.
- Les permissions sont centralisées dans la matrice des autorisations ; `my_access()` et son API équivalente alimentent les gardes d'écran. Les rôles système et personnalisés sont propres à la société. L'ancienne table `user_roles` a été supprimée par V32.
- Le front et l'API partagent `module-access.json` pour l'accès aux modules. La visibilité d'un bouton accompagne les contrôles de la base et du serveur ; elle ne les remplace pas.
- Sur site, le rôle applicatif `qerp_api` reste non propriétaire et sans contournement RLS. Le contexte utilisateur est posé pour chaque transaction ; les migrations utilisent un rôle distinct.
- Le cache est vidé lors de la déconnexion. Les lectures, clés de cache et exports de données métier doivent respecter le périmètre société ; une consolidation ne peut inclure que les sociétés accessibles.

Consulter [l'identité sur site](docs/audit-erp/26-identite-sur-site.md) pour la reprise des comptes, la clé de signature, le verrouillage des connexions et les limites. La réinitialisation locale par courriel et la double authentification n'y sont pas disponibles ; le mot de passe provisoire administrateur est le mécanisme de secours documenté. La messagerie des relances ne constitue pas une implémentation de récupération de compte.

<a id="comptabilite"></a>

## Comptabilité et reporting CFO

Les jeux de comptes, codes de taxe, sections analytiques, séries de numérotation et périodes se configurent par société. Les contrôles serveur peuvent refuser une opération si un compte manque, si la période est fermée ou si les droits et approbations sont insuffisants. Les contre-passations et l'audit sont documentés dans les migrations et recettes comptables.

Le reporting CFO possède des règles particulières définies dans [AGENTS.md](AGENTS.md) :

- Les tenants demandés sont intersectés côté serveur avec `get_accessible_tenants` ; la sélection d'écran ne peut pas élargir l'accès.
- Le CSV consolidé réutilise les résultats KPI et tendances affichés, sur les mêmes sociétés et la même période.
- Les tendances sont calculées côté serveur. La trésorerie passée exige des clôtures mensuelles complètes du mois exact ; l'absence d'historique reste `NULL`. Le cash courant de cette série porte sur les comptes **XOF actifs**, sans conversion monétaire implicite.
- Les échecs CFO remontent sans nouvelle tentative automatique ; l'utilisateur dispose d'une récupération explicite.
- Les données bancaires sont bornées par `useTenantId` et toutes les pages ordonnées de transactions sont lues avant agrégation ou export, pour éviter une troncature silencieuse.

Voir aussi les guides [trésorerie/règlements](docs/audit-erp/13-tresorerie-reglements.md), [comptabilisation paramétrable](docs/audit-erp/20-comptabilisation-parametrable-par-module.md) et [contrôles réels](docs/audit-erp/21-ecrans-de-controle-et-parametres-reels.md).

<a id="documents"></a>

## Documents, PDF et relances

Deux circuits coexistent : les exports et impressions produits dans le navigateur, et les **éditions serveur archivées**. Les seconds figent les données de la pièce et la version publiée du modèle, puis conservent le PDF et son empreinte. Une réimpression reprend l'archive ; un remplacement explicite et motivé crée une nouvelle édition.

Les factures clients et les bons de commande sont raccordés au circuit des modèles versionnés. Cela ne signifie pas que toutes les pièces du produit disposent déjà de ce circuit. Voir [modèles et archives](docs/audit-erp/30-documents-modeles-et-archives.md).

Le moteur Gotenberg peut être démarré séparément :

```powershell
docker compose -f infra/pdf/compose.yml up -d --build
```

Il reste sur un réseau Docker interne, sans port hôte publié. Cette commande seule ne raccorde pas l'API au moteur. Suivre le [guide PDF](infra/pdf/README.md) et adapter ses paramètres à la base utilisée : l'overlay [compose.api.yml](infra/pdf/compose.api.yml) vise explicitement **`qerp_reel`**, alors que le Compose de démarrage crée **`qerp`**. Ne pas l'appliquer tel quel à une installation neuve sans adapter cette cible.

Le rendu archivé contrôle la sortie PDF/A-2b et conserve ses fichiers sur un stockage privé : répertoire serveur sur site, compartiment Supabase dans le nuage. Le moteur, les polices, le stockage persistant et les droits doivent être configurés. Le rendu nuage demande aussi le déploiement de la fonction Edge et un moteur joignable depuis cet environnement.

Les [relances clients](docs/audit-erp/31-relances-clients-executees.md) implémentent l'aperçu, l'envoi **manuel** par SMTP et l'historique avec prévention des doublons. Elles suivent les règles configurées, sans modifier le solde de la facture. La planification, les SMS et les lettres ne font pas partie de cette tranche. Le guide indique les opérations de déploiement et de recette encore nécessaires ; la présence du code ne prouve pas qu'un courriel réel peut être envoyé.

<a id="i18n"></a>

## Langues et formats

La migration i18n est en cours. Le PoC français/anglais comprend le socle de traduction, les préférences, une bascule sans démontage des formulaires, un périmètre pilote d'écrans, des refus métier traduits et la langue des éditions. **Toute l'application n'est pas traduite.** Les écrans hors périmètre peuvent rester en français et afficher un avertissement.

- Les catalogues sont dans `src/i18n/locales/<langue>/<namespace>.json`, chargés à la demande.
- Langue des textes, locale de formatage, fuseau horaire et pays/référentiel métier sont des réglages distincts. La devise reste celle de la pièce ou de la société.
- L'onglet `/settings?tab=languages` porte les préférences et les réglages société ; la partie administrable exige `languages.settings`.
- La migration V155 et sa jumelle ajoutent les données de langues et formats. Leur déploiement suit le guide dédié ; les environnements existants doivent être vérifiés séparément.
- Les documents, alertes et relances ont encore des limites de traduction et de formatage. Le centre complet de gestion des traductions reste une cible progressive.

Lire d'abord la [baseline i18n actuelle](docs/i18n/QERP_I18N_ARCHITECTURE_BASELINE_V1.md), puis le [rapport d'exécution du PoC](docs/i18n/QERP_I18N_POC_EXECUTION_REPORT.md) et le [guide migration/retour arrière](docs/i18n/QERP_I18N_MIGRATION_AND_ROLLBACK.md). Les documents de cible et de backlog décrivent aussi des fonctions futures.

<a id="design-system"></a>

## Charte, design system et responsive

L'identité du produit **QERP** est distincte de celle de son éditeur **QUOREICH GROUP** et de l'identité des sociétés utilisatrices. La [charte graphique](docs/charte%20graphique.pdf) fournit la palette et les polices ; la référence d'implémentation est [docs/design-system.md](docs/design-system.md), qui précise leur application, les lots déjà migrés et les adaptations restantes.

- Bleu de marque **`#0062db`**, accent orange **`#ff8a51`** ; couleurs de statut et surfaces pilotées par les tokens sémantiques de `src/index.css`.
- **Montserrat** pour l'interface et les données, **Playfair Display** pour les titres principaux. Les polices et licences sont livrées dans [public/fonts](public/fonts), sans dépendance à Google Fonts pour leur chargement dans l'interface.
- Préférences **Clair / Sombre / Appareil** ; accueil **Essentiel / Entreprise**. Elles sont conservées sur l'appareil et disponibles avant la connexion ainsi que depuis le compte.
- Le logo QERP est présenté dans un bandeau blanc plein, centré, avec uniquement l'arrondi inférieur gauche validé.
- `PageHeader`, `Button`, `Table`, `StatusBadge`, contrôles de tri/pagination, dialogues et panneaux partagés définissent les conventions. Les listes migrées utilisent les cartes mobiles sous 768 px ; les autres listes restent à adapter.
- Les tableaux défilent localement, les actions se replient, les formulaires commencent sur une colonne. Les dialogues contrôlés sans `DialogTrigger` doivent rendre explicitement le focus à leur initiateur.
- Les demandes de prix reprennent ces cartes pour le registre, les lignes, les fournisseurs et le comparatif ; leurs exports utilisent le registre affiché. La création, les offres et l'annulation avec motif utilisent les formulaires et dialogues du design system.

L'icône produit est fournie en [SVG](public/branding/qerp-favicon.svg), [ICO](public/favicon.ico) et [Apple Touch](public/branding/qerp-touch-icon.png). `npm run branding:icons` régénère les fichiers depuis le SVG avec [le script dédié](scripts/branding/generate-favicons.mjs) ; Chromium Playwright doit être installé. Cette commande ne nécessite pas de service distant.

<a id="commandes"></a>

## Commandes et vérifications

Les scripts disponibles sont définis dans [package.json](package.json). Adapter la vérification au changement ; les nombres de tests des rapports sont des résultats datés, pas une garantie permanente.

| Commande à la racine | Usage |
|---|---|
| `npm run dev` / `npm run dev:cloud` | Serveur Vite, mode par défaut / mode `cloud`. |
| `npm run build` / `npm run build:dev` | Bundle dans `dist/`, mode production / développement. |
| `npm run preview` | Servir le bundle construit pour vérification locale. |
| `npm run lint` | Analyse ESLint ; une partie des textes pilotes i18n est contrôlée. |
| `npx tsc --noEmit -p tsconfig.app.json` | Vérification TypeScript de l'application. |
| `npx tsc --noEmit -p tsconfig.node.json` | Vérification TypeScript des configurations concernées. |
| `npm test` / `npm run test:watch` | Vitest en passage unique / surveillance. |
| `npm run api:types` / `npm run api:check` | Génération des types OpenAPI / vérification de leur dérive. |
| `npm run db:check-twins` | Vérification du contenu et de l'ordre des migrations jumelles. |
| `npm run i18n:check` | Cohérence des catalogues, variables, erreurs et contraintes du périmètre pilote. |
| `npm run i18n:menu` | Génération du catalogue de navigation. |
| `npm run i18n:budget` | Contrôle du budget d'entrée, après construction du bundle. |
| `npm run branding:icons` | Régénération des icônes du produit. |
| `npm run test:e2e` / `npm run test:e2e:ui` | Suite Playwright principale / interface de lancement. |
| `npm run test:e2e:parcours` | Parcours connectés au vrai backend Supabase de recette. |
| `npm run test:e2e:sur-site` | Parcours connectés à l'API Java et à PostgreSQL local. |
| `npm run test:e2e:report` | Ouvrir le rapport Playwright principal. |

Vite construit le bundle sans effectuer à lui seul les deux contrôles `tsc`. La [CI](.github/workflows/ci.yml) décrit la combinaison lint, types, tests, contrats, migrations, i18n et build attendue pour une livraison.

### Tests de bout en bout

Installer Chromium pour Playwright avant la première exécution : `npx playwright install chromium`.

La [configuration principale](playwright.config.ts) démarre son propre front construit sur **8082** (`E2E_PORT` surchargeable) et simule les réponses backend de nombreuses spécifications. Elle ne démontre pas, à elle seule, le fonctionnement des déclencheurs ou de la RLS réels.

Les [parcours nuage](playwright.parcours.config.ts), sur **8081**, et [sur site](playwright.sur-site.config.ts), sur **8083**, utilisent des comptes et sociétés de recette préparés. Ils peuvent **créer des données métier**. Fournir `E2E_EMAIL` / `E2E_PASSWORD`, ou un fichier hors dépôt désigné par `E2E_CREDENTIALS_FILE`, selon les fixtures. Les parcours sur site exigent aussi les comptes locaux, la société de recette et une origine CORS correspondant au front ; `E2E_API_URL` définit l'API cible. Ne pas les lancer avec un compte ou une société d'exploitation.

Les scripts de préparation sont dans [scripts/e2e](scripts/e2e). Des configurations dédiées existent aussi pour le stock PostgreSQL, la trésorerie en lecture et la recette ROXGOLD. Lire leurs prérequis avant exécution ; le [plan E2E](docs/audit-erp/08-plan-de-tests-e2e.md) décrit les scénarios métier.

### Tests Java

Depuis `services/api`, avec `JAVA_HOME` sur le JDK 25 :

```powershell
.\mvnw.cmd test
.\mvnw.cmd verify
```

`test` exécute les tests unitaires ; `verify` inclut les `*IT` via Failsafe et démarre des PostgreSQL jetables avec Testcontainers. **Docker doit fonctionner** pour ces tests d'intégration. Les rapports sont dans `target/surefire-reports` et `target/failsafe-reports`. Les propriétés `qerp.it.contextCache` et `qerp.it.heap` permettent d'ajuster les ressources de la suite.

Les fonctions Edge ont leurs propres tests Deno et prérequis réseau, décrits dans [supabase/functions/README.md](supabase/functions/README.md).

<a id="migrations"></a>

## Migrations et contrats

Le schéma est un actif versionné commun aux deux hébergements :

- **Sur site** : Flyway applique `services/api/src/main/resources/db/migration/V*__*.sql` au démarrage. Hibernate valide le schéma ; il ne le met pas à jour.
- **Nuage** : les évolutions ont leurs jumelles dans `supabase/migrations`. Le script [deploy-supabase.sh](scripts/schema/deploy-supabase.sh) compare les empreintes et tient le registre `qerp_deploy.applied_migrations`.
- La base de référence V1–V15 provient d'une reprise de schéma documentée. Les évolutions suivantes doivent rester synchronisées ; ne pas réécrire une migration appliquée. Le [guide des migrations](services/api/src/main/resources/db/migration/README.md) explique la provenance et les règles du socle.
- `drizzle/` conserve un historique antérieur ; sa présence ne remplace pas le contrôle des jumelles ni la procédure de livraison actuelle.

Commandes du schéma nuage, après préparation de la connexion d'administration dans l'environnement :

```bash
npm run db:check-twins
npm run db:deploy-supabase -- --dry-run
npm run db:supabase-bundle > rattrapage.sql
# Application des migrations manquantes dans l'environnement cible :
npm run db:deploy-supabase
```

`--dry-run` liste les migrations en attente ; le script peut initialiser son registre technique. Le bundle généré est destiné au rattrapage décrit par le script, pas à une installation arbitraire sur une base vide. Vérifier cible, sauvegarde et état du registre avant l'application. Le [workflow Supabase](.github/workflows/deploy-supabase.yml) utilise le secret d'environnement `SUPABASE_DB_URL` après la CI sur `main` ; sa présence ne prouve pas qu'un environnement donné a effectivement été mis à jour.

Le contrat Java est dans [qerp-api.json](services/api/openapi/qerp-api.json), les types générés dans `src/api/qerp-schema.ts`. Après une modification d'API, suivre les tests de contrat côté Java, puis `npm run api:types` et `npm run api:check`. Ne pas éditer ces types à la main. Les types Supabase constituent une autre source générée ; leur régénération suit l'état du schéma nuage.

La parité du socle avec le dump original dispose de `scripts/schema/verify-lot0.sh`. Ce contrôle exige une sauvegarde conservée **hors dépôt**, contenant potentiellement des données personnelles ; il n'est pas reproductible à partir d'un clone seul.

<a id="exploitation"></a>

## Déploiement et exploitation

Le front construit par `npm run build` est livré dans `dist/`. L'hébergeur doit servir les routes SPA en retombant sur `index.html`, et le bundle doit viser le bon backend. `npm run preview` sert à vérifier une construction localement. Lovable peut être un canal d'hébergement du front ; il n'est plus la description de toute l'architecture.

L'image Java se construit depuis [services/api/Dockerfile](services/api/Dockerfile) :

```powershell
docker build -t qerp-api:local services/api
```

Le [Compose de développement](infra/compose.dev.yml) n'est pas un manifeste de production. Il ne monte notamment pas de volumes persistants pour les fichiers et la clé d'identité de l'API. Une installation durable doit prévoir leur stockage privé, leurs droits et leur sauvegarde avant de recréer le conteneur.

Le [plan de bascule](docs/PLAN-BASCULE-JAVA.md) couvre l'hébergement, les sauvegardes et la restauration. Certaines options initiales y ont évolué : pour l'implémentation actuelle, suivre les décisions plus récentes sur [l'identité locale](docs/audit-erp/26-identite-sur-site.md), [le jumeau Java](docs/audit-erp/25-jumeau-sur-site.md), [le PDF](infra/pdf/README.md) et [le bilan des lots](docs/audit-erp/28-bilan-lots-et-ecarts.md). Ne pas installer Keycloak ou MinIO uniquement parce qu'ils figurent dans une cible historique.

L'exploitation doit couvrir le proxy TLS, les origines autorisées, les secrets serveur, le stockage des archives, les migrations, les sauvegardes hors site et une restauration vérifiée. Sur site, protéger et sauvegarder `QERP_IDENTITY_KEY_FILE` ; sa perte ou sa divulgation affecte les sessions. La disponibilité SMTP, du moteur PDF et du fournisseur d'IA se vérifie séparément du démarrage de l'API.

Pour diagnostiquer : journaux Compose de l'API, identifiants de corrélation, réponses de santé et journaux des fonctions Edge. `/health` vérifie la vivacité du processus ; les endpoints Actuator de santé/disponibilité complètent ce diagnostic. Les métriques et Prometheus sont présents, avec accès protégé ; Swagger est activé uniquement sous `dev`. Aucun SLA, RPO ou RTO ne peut être annoncé sur la seule base de ces fichiers.

<a id="documentation"></a>

## Documentation de référence

| Besoin | Point d'entrée |
|---|---|
| Règles de contribution et invariants CFO | [AGENTS.md](AGENTS.md) |
| État fonctionnel, preuves et écarts | [Index des audits ERP](docs/audit-erp/README.md), [bilan actualisé](docs/audit-erp/28-bilan-lots-et-ecarts.md) |
| Périmètre produit et exigences | [Cahier des charges v1.1](docs/quoreich-cahier-des-charges-v1.1.md) — exigences à distinguer de l'état livré |
| Architecture et migration Java | [Plan de bascule](docs/PLAN-BASCULE-JAVA.md), [portage sur site](docs/audit-erp/25-jumeau-sur-site.md) |
| Identité, sessions et reprise des comptes | [Identité sur site](docs/audit-erp/26-identite-sur-site.md) |
| Modèles, archives et rendu | [Documents versionnés](docs/audit-erp/30-documents-modeles-et-archives.md), [moteur PDF](infra/pdf/README.md) |
| Courriels de recouvrement | [Relances exécutées](docs/audit-erp/31-relances-clients-executees.md) |
| RH et paie | [Audit et améliorations](docs/audit-erp/32-audit-rh-paie.md), [recette paie](docs/recette-paie-v80.md) |
| Interface et accessibilité | [Design system](docs/design-system.md) |
| Traductions et déploiement i18n | [Baseline actuelle](docs/i18n/QERP_I18N_ARCHITECTURE_BASELINE_V1.md), [migration et retour arrière](docs/i18n/QERP_I18N_MIGRATION_AND_ROLLBACK.md) |
| Fonctions Edge et erreurs | [Diagnostics Supabase](supabase/functions/README.md) |

Les noms historiques « QUOREICH » dans des documents, paquets ou commentaires sont conservés quand ils désignent leur provenance. L'identité du produit présentée aux utilisateurs est **QERP** ; son éditeur est **QUOREICH GROUP**.
