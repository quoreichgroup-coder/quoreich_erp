# QUOREICH — Plan de bascule du backend vers Java/Spring

Version 1.0 — 9 novembre 2026.
S'appuie sur `docs/quoreich-cahier-des-charges-v1.1.md` (elle-même révision de la v1.0 du 3 novembre 2026).

**Statut : proposition à approuver.** Ce document décrit la cible, le séquencement et les critères de sortie. Il ne vaut ni engagement de délai ni engagement de coût.

---

## 1. Principes directeurs

1. **Le schéma PostgreSQL existant est l'actif, pas la dette.** Il n'est pas réécrit : il est repris comme contrat de départ, puis étendu.
2. **Les invariants comptables restent dans la base.** Équilibre débit/crédit, immuabilité des écritures comptabilisées, verrous de période, chaîne d'audit et isolation par société continuent de s'appliquer même si le code applicatif est faux. C'est la lecture de **FIN-01** et de **TEC-09**.
3. **Aucun module n'est accepté sur la seule présence de pages** (**REC-06**). Chaque lot se ferme sur des preuves.
4. **On ne porte pas ce qui n'existe pas.** Les six modules incomplets se construisent directement sur la cible ; ils ne se traduisent pas depuis les hooks morts.
5. **La migration est progressive et réversible.** Chaque domaine bascule derrière un indicateur ; le retour arrière est possible domaine par domaine.

---

## 2. Cible technique (versions à figer)

| Brique | Version | Remarque |
|---|---|---|
| Java | **25 LTS** | GA 16/09/2025, LTS confirmé (OpenJDK, Adoptium) |
| Spring Boot | **4.1.2** | Exclure 4.2.0-RC2 (préversion) |
| Spring Framework | **7.0.10** minimum | Exigé par Boot 4.1.2 |
| Spring Security | **7.1.2** | Ligne 7.1.x pour Boot 4.1 ; ne pas viser 6.x |
| Hibernate ORM | **7.4.15.Final** | Fourni par Boot 4.1 |
| PostgreSQL | **18.6** | 19 = RC, exclu |
| Maven | **3.10.0** + wrapper | Le document de stack indiquait 3.9.x : en retard |
| Flyway | **13.12.1** | Apache 2.0 + module `flyway-database-postgresql` |
| Keycloak | **26.8.2** | Fournisseur OIDC auto-hébergé |
| Quartz | **2.5.2** | `spring.quartz.job-store-type=jdbc` |
| Testcontainers | **2.0.5** | Rupture : modules renommés, module `testcontainers-postgresql` |
| Gotenberg | **9.2.0** | MIT, rendu Chromium |
| Node.js | **26.13 LTS** | Figé dans `.nvmrc`, `engines`, CI et image de build |
| React / Vite | 18.3.1 → **19.3.1** / 5 → **8.3** | Montée planifiée, voir lot 1bis |
| Tailwind | 3.4.17 → **4.3.5** | Outil de migration officiel |
| Expo / RN | **58** / **0.88** | Couplés ; impose React 19.3 |

**Pièges de plateforme à intégrer dès le squelette :**

- **Jackson 3.0** arrive avec Boot 4 : comportement de sérialisation modifié, à valider sur les contrats.
- **Threads virtuels** : `spring.threads.virtual.enabled=true` désactive les pools configurés ; les threads virtuels sont des démons, donc `spring.main.keep-alive=true` est requis dès qu'on utilise `@Scheduled`. Quartz utilise ses propres workers : à tester explicitement.
- **Chemin de migration officiel** : 3.5 → 4.0 → 4.1. Autant démarrer directement en 4.1 sur un projet neuf.
- **Renommages** : `management.tracing.enabled` → `management.tracing.export.enabled`, `spring.dao.exceptiontranslation.enabled` → `spring.persistence.exceptiontranslation.enabled`.
- **`-DskipTests` ne saute plus l'AOT des tests** en 4.1 : utiliser `maven.test.skip`.

---

## 3. Ce qui reste en PostgreSQL, ce qui migre

| Reste en base (définitif) | Migre vers Java |
|---|---|
| Contrainte d'équilibre débit/crédit | Orchestration des cas d'usage |
| Immuabilité des écritures comptabilisées | Transactions multi-agrégats |
| Verrous et réouvertures de période | Calculs de consolidation et tendances |
| Chaîne d'audit et journalisation | Workflows d'approbation (seuils, étapes, délégations) |
| Politiques RLS et isolation par société | Génération des exports CSV/PDF |
| Contraintes d'unicité, clés étrangères, idempotence par référence | Contrats OpenAPI et validation d'entrée |
| Vues d'analyse (aging, grand livre) | Rendu des documents (chapitre 24) |
| Séquencement et règles de numérotation légale | Tâches planifiées, notifications, temps réel |

**Méthode de transition.** Java appelle d'abord les fonctions plpgsql existantes, puis les absorbe domaine par domaine. Pour chaque fonction absorbée : l'ancienne implémentation SQL est conservée en test de référence jusqu'à la fin du lot, puis supprimée après acceptation.

**Règle d'accès.** L'API ne se connecte **jamais** avec un rôle superutilisateur. Elle utilise un rôle non privilégié et fixe le contexte société dans la transaction avant tout accès. Sans cela, les 186 politiques RLS deviennent décoratives et **SEC-01** n'est plus tenu.

---

## 4. Découpage des domaines

```
services/api/
  identity/       authentification, sociétés, profils, rôles, modules et licences
  ledger/         plan comptable, journaux, écritures, clôtures, audit
  receivable/     clients, factures, encaissements, aging, recouvrement
  payable/        fournisseurs, factures, approbations, paiements
  treasury/       comptes, mouvements, rapprochement, prévision, clôture
  assets/         registre, amortissements, cessions
  procurement/    demandes, commandes, réceptions, rapprochement 3 voies
  sales/          devis, commandes, livraisons, facturation
  inventory/      articles, entrepôts, mouvements, inventaires, valorisation
  budget/         budgets, engagements, scénarios
  project/        projets, coûts, rentabilité
  expense/        notes de frais, politiques, approbations
  payroll/        employés, cycles, calculs, exports
  crm/            contacts, opportunités, activités
  compliance/     référentiels de contrôle, constats
  risk/           registre des risques, cartographie
  reporting/      reporting CFO, centre de rapports
  documents/      modèles, rendu PDF, pièces émises
  platform/       idempotence, outbox, tâches, notifications, audit technique, observabilité
```

Règle de frontière, vérifiée automatiquement par **ArchUnit** : un domaine ne dépend d'un autre que par son interface publique. Aucun accès direct aux tables d'un autre domaine.

---

## 5. Méthode de vérification (code écrit par agents)

La contrainte principale n'est pas la production de code, c'est sa **vérification**. Quatre garde-fous, obligatoires, pas optionnels.

### 5.1 L'ancien SQL est l'oracle

Pour chaque domaine porté :

1. figer un jeu de données de référence (anonymisé si besoin) ;
2. exécuter l'ancienne implémentation (RPC / vue / trigger) sur ce jeu ;
3. exécuter la nouvelle implémentation Java sur le même jeu ;
4. comparer les sorties ligne à ligne, y compris les arrondis et les valeurs nulles.

Un écart non expliqué bloque le lot. C'est le seul moyen de prouver qu'un agent n'a pas réinventé une règle comptable plausible mais fausse.

### 5.2 Tests exécutables, pas descriptifs

| Type | Ce qu'il couvre |
|---|---|
| Parité (5.1) | Comportement identique à l'existant sur les modules portés |
| Propriétés | Invariants comptables : équilibre, idempotence, arrondis, non-négativité |
| Contrat | Le client généré depuis OpenAPI compile et les routes répondent conformément |
| Isolation | Recette négative **SEC-07** : société non autorisée, requête modifiée, utilisateur sans rôle |
| Persistance | Testcontainers : schéma reconstruit depuis zéro, comparé objet par objet au dump |
| Documents | PDF émis identique après republication ; script neutralisé ; polices incorporées |

### 5.3 Frontières et qualité automatiques

- **ArchUnit** : dépendances entre domaines interdites hors interface.
- **Analyse statique** : règles de style et de sécurité bloquantes en CI.
- **Aucune fusion sans CI verte.** Aucune exception négociée à la main dans la CI.

### 5.4 Validation humaine

Chaque lot est signé par une personne sur les points suivants, au minimum :

- isolation par société ;
- verrouillage de période et immuabilité ;
- arrondis et devises ;
- droits et séparation des tâches.

Les agents produisent et vérifient ; quelqu'un répond.

---

## 6. Lots

Les lots sont ordonnés par dépendance. **Aucune durée calendaire n'est fixée ici** (LOT-03) : les poids relatifs permettent d'ordonner et de dimensionner une fois le périmètre validé.

| Lot | Contenu | Poids relatif | Dépend de |
|---|---|---|---|
| 0 | Reprise du schéma et parité | 10 % | — |
| 1 | Socle applicatif et identité | 12 % | 0 |
| 1bis | Correctifs et montées de version du client web | 8 % | — |
| 2 | Première tranche verticale : AR | 12 % | 1 |
| 3 | AP, GL, achats | 18 % | 2 |
| 4 | Ventes/stocks, trésorerie, immobilisations | 18 % | 3 |
| 5 | Modules à construire | 14 % | 3 |
| 6 | Documents et report management | 5 % | 2 |
| 7 | Application mobile | 3 % | 2, 3 |

### Lot 0 — Reprise du schéma et parité

**Problème à résoudre d'abord.** `supabase/migrations/` n'est pas un schéma rejouable : la fonction `get_consolidated_cfo_trends` n'existe que dans `drizzle/migrations/`. Le dossier de migrations n'est donc pas une source de vérité.

**Source de vérité retenue :** le dump `docs/flow-bright-desk_261109.backup` (format custom, produit le 9 novembre 2026 à 17:19). Inventaire vérifié :

| Élément | Valeur constatée |
|---|---|
| Version de la base dumpée | **PostgreSQL 17.6** |
| Client `pg_dump` | 18.6 |
| Entrées TOC | 1 945 |
| Schéma `public` — tables | **105** |
| Schéma `public` — vues | **36** |
| Schéma `public` — fonctions | **105** |
| Schéma `public` — triggers | **60** |
| Schéma `public` — politiques RLS | **157** |
| Schéma `public` — contraintes | **264** |
| Clés étrangères vers `auth.users` | **16** dans `public` (26 au total dans le dump, dont 10 internes au schéma `auth`) |
| Schémas Supabase internes inclus | `auth` (27 tables), `storage` (10), `realtime` (10), + `cron` |
| Extensions | `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `supabase_vault`, `uuid-ossp` |
| Données incluses | 156 tables (dump complet, pas `--schema-only`) |

**Deux écarts à traiter avant toute chose :**

1. **Le dump contient des données de production.** `auth.users` (courriels, identifiants) et les tables métier complètes : paie, coordonnées bancaires, clients. **Ce fichier ne doit pas rester dans le dépôt.** Il doit être déplacé hors du contrôle de version, et seule une extraction anonymisée doit servir aux tests.
2. **Il vient de PostgreSQL 17.6**, alors que la cible est 18.6. La restauration logique d'un dump 17.6 vers 18.6 est le chemin d'upgrade normal, mais elle doit être exécutée et vérifiée, pas supposée.

**Dépendances Supabase du schéma `public` — le point structurant.**

Le schéma `public` ne dépend d'aucun objet `storage`, `realtime`, `net`, `vault` ou `cron`. En revanche il dépend massivement de l'authentification Supabase :

- **157 politiques RLS** s'appuient sur `auth.uid()`, plus `auth.jwt()` et `auth.role()` ;
- **16 clés étrangères** de `public` pointent vers `auth.users` (`profiles.id`, `created_by`, `approved_by`, `employee_id`, ...).

Conséquence : supprimer le schéma `auth` casserait l'isolation et l'intégrité. Deux parades, à appliquer ensemble :

- **Compatibilité d'autorisation.** Fournir un schéma `auth` minimal exposant `uid()`, `jwt()` et `role()`, alimenté par les variables de session fixées par l'API. Les 157 politiques restent **inchangées** — aucune réécriture, donc aucun risque de régression sur SEC-01.
- **Compatibilité d'identité.** Importer les utilisateurs dans Keycloak **en conservant leurs UUID d'origine** (l'import d'un royaume accepte un identifiant explicite par utilisateur). Les 26 clés étrangères restent alors valides sans migration de données. À vérifier en recette ; si l'import échoue, DEC-07 s'applique.

Ce qui est abandonné, et n'a pas besoin d'équivalent : `storage` (remplacé par MinIO), `realtime` (remplacé par SSE/WebSocket), `cron` (remplacé par Quartz), `pg_net` et `supabase_vault` (propres à Supabase, non disponibles sur un PostgreSQL standard).

**Travail :**

1. Sortir le dump du dépôt ; produire une extraction anonymisée pour les tests.
2. Restaurer le dump dans un PostgreSQL 18.6 jetable et vérifier la montée de version 17.6 → 18.6.
3. Extraire le schéma `public` seul et le découper en migrations Flyway ordonnées : types → tables → contraintes → index → vues → fonctions → triggers → politiques → droits, plus le schéma de compatibilité `auth`.
4. Relecture manuelle des objets PL/pgSQL : une génération automatique ne capture pas fidèlement 105 fonctions et 60 triggers.
5. Test Testcontainers qui reconstruit la base depuis **zéro** et compare objet par objet au dump : 105 tables, 36 vues, 105 fonctions, 60 triggers, 157 politiques, 264 contraintes.
6. Jeu de données de référence anonymisé pour l'oracle des lots 2 à 4.

**Critère de sortie :** la base reconstruite depuis une base vide est **identique** au dump objet par objet, les 157 politiques sont actives, et une lecture hors société est refusée. Le test le prouve en CI.

**État au 9 novembre 2026 — critère atteint en local.** Exécution reproductible par `bash scripts/schema/verify-lot0.sh <dump>` :

| Point vérifié | Résultat |
|---|---|
| Restauration du dump (17.6) en PostgreSQL **18.6** | 105 tables, 36 vues, 105 fonctions, 60 triggers, 157 politiques |
| Migrations `V1..V15` rejouées sur une base **vide** | 15 migrations, aucune erreur |
| Parité objet par objet (manifeste de 2 885 lignes : colonnes, contraintes, index, définitions de fonctions, vues, triggers, politiques avec `qual`/`with_check`, RLS, séquences, énumérations, FK) | **zéro écart** |
| Recette négative d'isolation (lecture, écriture, contexte absent) | **toutes les assertions passent** ; la RLS échoue fermée |
| Régénération des migrations depuis le dump et comparaison aux fichiers versionnés | aucune dérive |

Écarts assumés par rapport au dump, à connaître :

- **Les ACL d'origine ne sont pas rejouées.** Elles ciblaient `sandbox_exec`, `dashboard_user`, `supabase_*_admin` et accordaient `ALL` sur les 141 relations à `anon` comme à `authenticated`. Les droits sont réécrits dans `V15__privileges.sql` (voir ci-dessous). L'original est conservé pour audit dans `scripts/schema/reference/acl-original.sql`.
- **Le schéma `auth` est réduit à `auth.users(id)` et quatre fonctions.** Vérifié : aucune fonction ni vue de `public` ne lit une autre colonne de `auth.users`.
- **Le trigger `on_auth_user_created` (sur `auth.users`) n'est pas recréé** : le provisionnement des profils devient une responsabilité de l'API au lot 1.
- **La publication `supabase_realtime` et ses 18 tables** ne sont pas rejouées (remplacée par SSE/WebSocket).
- **Le jeu de recette est synthétique**, pas anonymisé : plus sûr, et suffisant pour l'oracle des lots 2 à 4.
- **La CI n'existe pas encore** : la vérification tourne en local via Docker. La chaîne CI arrive au lot 1.

### Lot 1 — Socle applicatif et identité

**Travail :**

1. Squelette Spring Boot 4.1.2 / Java 25, monolithe modulaire, ArchUnit actif dès le premier commit.
2. Keycloak : realm, clients web et mobile, rôles et groupes ; contexte société porté par le jeton. Import des utilisateurs **en conservant les UUID d'origine** pour que les 26 clés étrangères vers `auth.users` restent valides (lot 0).
3. Couche multi-tenant : résolution depuis le jeton, fixation du contexte dans la transaction, connexion non privilégiée.
4. Contrat OpenAPI + génération du client TypeScript.
5. `/health`, identifiant de corrélation, journalisation structurée, métriques.
6. Chaîne d'intégration : build, tests, Testcontainers, analyse statique, image conteneur.
7. Compose de développement et premier déploiement sur le VPS.

**Critère de sortie :** une requête authentifiée renvoie une donnée filtrée par société, et la recette négative (autre société, contexte modifié) est refusée côté serveur **sans effet partiel**.

### Lot 1bis — Correctifs et montées de version du client web

Ce lot ne dépend d'aucun autre et peut démarrer immédiatement.

1. **Découpe du bundle.** Aujourd'hui : un seul chunk JavaScript de **3,0 Mo** (mesuré le 9 novembre 2026), 111 routes importées en eager, aucun `React.lazy`, aucun `Suspense`, aucun découpage manuel. Mettre en place le chargement par route, le découpage des dépendances lourdes et le chargement à la demande des bibliothèques d'export.
2. **Virtualisation** des tableaux denses (aging, journaux), aujourd'hui paginés en mémoire à 10 lignes.
3. **Cache de requêtes** : options par défaut explicites, et vidage du cache à la déconnexion — aujourd'hui `signOut()` ne le fait pas, ce qui est aussi une fuite entre comptes.
4. **Charte QUOREICH** (UX-01 révisé) : variables de thème, typographies, vérification du contraste.
5. **Montées de version** : React 19.3, Tailwind 4, puis vérification de `recharts` et `react-day-picker`.

**Critère de sortie :** le premier écran ne charge plus qu'une fraction du bundle, les tableaux de plus de 200 lignes restent fluides, et la charte est appliquée sans couleur codée en dur.

### Lot 2 — Première tranche verticale : AR

AR est choisi en premier parce que le module est **complet jusqu'à l'écran** (référentiels, factures, encaissements, aging, exports), ce qui permet de valider toute la chaîne : identité, société, contrat, écran, export, recette.

**Critère de sortie :** facture → créance → écriture équilibrée ; paiement partiel → solde exact ; paiement final → soldé ; période close → refus sans effet ; export conforme aux droits (**AR-REC**). Parité démontrée avec l'implémentation SQL existante.

### Lot 3 — AP, GL, achats

**Critère de sortie :** les critères **AP-REC**, **GL-REC** et **ACH-REC** sont satisfaits, y compris le rapprochement 3 voies et le refus de paiement en cas de blocage.

### Lot 4 — Ventes/stocks, trésorerie, immobilisations

Inclut la correction des écarts **ECART-01** : marge calculée sur coûts réels (plus d'hypothèse de coût fixe), historique de trésorerie reconstitué ou déclaré indisponible, aucune donnée fictive réutilisée comme historique.

**Critère de sortie :** **VEN/STK-REC**, **TRE-REC**, **IMM/BUD/PRO-REC**.

### Lot 5 — Modules à construire

Budget, projets, dépenses, risques, référentiels de stocks, création de comptes et transactions de trésorerie, conformité.

Ces modules disposent de hooks d'écriture non branchés (18 points d'entrée). Ils ne sont **pas** portés : ils sont conçus sur la cible, avec les écrans branchés dessus, et leurs critères d'acceptation rédigés avant le développement.

**Critère de sortie :** pour chaque module, la matrice **REC-04** est couverte et aucune page ne présente de données statiques.

### Lot 6 — Documents et report management

Conforme au chapitre 24 de la v1.1 : modèles versionnés, éditeur embarqué, rendu isolé, PDF archivé, sécurité des modèles.

**Point de sécurité non négociable :** aucun moteur d'expression sur du contenu fourni par une société. Rendu par substitution de jetons dans un contexte figé ; HTML assaini côté serveur ; service de rendu sans accès réseau sortant.

**Critère de sortie :** les cinq points de **DOC-TPL-06**.

### Lot 7 — Application mobile

Conforme au chapitre 23 : Android d'abord, périmètre de consultation et validation, connexion OIDC, aucun mode hors ligne.

**Critère de sortie :** **REC-04** appliquée au mobile, plus perte de connexion, refus de permission native et expiration de jeton.

---

## 7. Hébergement VPS

### 7.1 Services

| Service | Rôle | Exposition |
|---|---|---|
| Proxy TLS | terminaison, renouvellement automatique | publique (443) |
| Client web | fichiers statiques | via proxy |
| Keycloak | identité OIDC | publique (authentification) |
| API Spring Boot | logique métier | interne |
| PostgreSQL | données | interne |
| Gotenberg | rendu PDF | interne, sans sortie réseau |
| MinIO | documents émis, actifs de modèles | interne |
| Prometheus / Grafana | métriques et tableaux de bord | interne, accès administrateur |
| Sauvegarde | export base + copie hors VPS | sortante uniquement |

### 7.2 Dimensionnement indicatif

| Composant | Mémoire |
|---|---|
| PostgreSQL | ~2 Go |
| API Spring Boot | ~1 Go |
| Keycloak | ~0,75 Go |
| Gotenberg (Chromium) | ~0,5 Go, avec pics par conversion |
| MinIO | ~0,3 Go |
| Supervision | ~1 Go |

**Plancher : 4 vCPU / 8 Go.** Confortable : **8 vCPU / 16 Go**. En dessous de 8 Go, le fournisseur d'identité et le rendu PDF se disputent la mémoire aux pires moments.

Gotenberg traite jusqu'à 6 conversions simultanées : suffisant pour un ERP émettant quelques dizaines à quelques centaines de documents par jour. Fixer malgré tout des limites de file, de taille de corps et de délai.

### 7.3 Sauvegarde et restauration

- export quotidien complet + journalisation continue ;
- copie **hors VPS** (stockage objet externe) ;
- exercice de restauration sur un VPS de remplacement, daté et documenté ;
- **aucun engagement de service annoncé avant que cet exercice ait réussi** (**NFR-03**, **DEC-08**).

---

## 8. Risques et parades

| Risque | Impact | Parade |
|---|---|---|
| Schéma non rejouable (fonctions présentes seulement dans `drizzle/`) | La base ne peut pas être reconstruite → aucun test fiable | Baseline depuis la base vivante + test de parité objet par objet (lot 0) |
| Code écrit par agents plausible mais faux sur les règles comptables | Écritures erronées, arrondis faux | Oracle SQL, tests de propriétés, signature humaine par lot |
| Contournement des RLS via une connexion privilégiée | Fuite entre sociétés | Rôle non privilégié, contexte fixé en transaction, recette négative obligatoire |
| Évaluation d'expression dans un modèle de document | Exécution de code côté serveur | Substitution de jetons uniquement, HTML assaini, rendu sans réseau sortant |
| Migration des mots de passe vers le nouveau fournisseur d'identité | Blocage à la bascule | DEC-07 : réinitialisation accompagnée ou import validé |
| VPS unique | Indisponibilité totale en cas de panne | Sauvegarde hors site + restauration testée + engagement de service honnête |
| Charge d'exploitation sous-estimée (Keycloak, TLS, sauvegardes, supervision) | Service dégradé faute de suivi | Responsabilités nommées dans TEC-08 ; supervision dès le lot 1 |
| Cascade de versions (mobile → React 19.3 → Tailwind 4) | Chantier front non planifié | Lot 1bis isolé et exécutable immédiatement |
| Mémoire de Chromium sur un VPS partagé | Rendu PDF en échec sous charge | Limites de file et de mémoire, file d'attente, alerte |
| Ordre des lots dicté par l'envie plutôt que par les dépendances | Rework | Séquence imposée : 0 → 1 → 2 → 3 |

---

## 9. Ce qui peut commencer immédiatement

Sans attendre l'approbation du reste du plan :

1. **Lot 0** — le `pg_dump` et la reconstruction de parité ne dépendent d'aucune décision métier. C'est aussi ce qui lève le risque le plus grave.
2. **Lot 1bis** — découpe du bundle, virtualisation, vidage du cache à la déconnexion, charte QUOREICH. Aucune dépendance sur le backend.

Ces deux chantiers sont réversibles, sans impact fonctionnel, et réduisent le risque des suivants.

---

## 10. Décisions encore ouvertes

| Réf. | Sujet | Bloque |
|---|---|---|
| DEC-07 | Migration des identités (réinitialisation, import ou coexistence) | Lot 1 |
| DEC-08 | RPO/RTO et engagement de service | Mise en service |
| DEC-09 | Version iOS | Lot 7 (Android non bloqué) |
| DEC-01 | Référentiel réglementaire et fiscal par pays | Lots 3, 4, 5 |
| DEC-02 | Politiques financières (arrondis, reconnaissance du revenu, tolérances achats) | Lots 2 à 4 |
| DEC-03 | Rôles par société et matrice de séparation des tâches | Lots 1 à 5 |

**DEC-03 est la plus structurante** : sans matrice de séparation des tâches validée, les workflows d'approbation des lots 3 et 5 ne peuvent pas être recettés.