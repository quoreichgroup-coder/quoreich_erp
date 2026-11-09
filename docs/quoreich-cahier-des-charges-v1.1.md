# QUOREICH — Cahier des charges — Version 1.1

Version 1.1 — 9 novembre 2026.
Révise la version 1.0 du 3 novembre 2026 (`docs/quoreich-cahier-des-charges-v1.md`).

**La v1.0 reste le document de référence pour tout ce qu'elle contient et que la présente révision ne modifie pas.** Ce document ne remplace donc pas la v1.0 : il la complète et en remplace les seules exigences listées au journal de changement, conformément à **VAL-02** (« versionner le cahier des charges ; ne pas modifier rétroactivement le périmètre accepté »).

---

## 00 — Journal de changement

| Réf. | Exigence v1.0 | Nature | Résumé |
|---|---|---|---|
| CHG-01 | **TEC-01** | Remplacement | Le backend n'est plus « Lovable Cloud sans serveur persistant » : il devient une API Java/Spring Boot. |
| CHG-02 | **TEC-08** | Ajout | Hébergement sur VPS unique, conteneurs, TLS, sauvegardes, RPO/RTO. |
| CHG-03 | **TEC-09** | Ajout | Stratégie multi-tenant côté API et maintien des politiques RLS. |
| CHG-04 | **UX-01** | Remplacement | Identité visuelle : charte QUOREICH GROUP remplace IBM Plex Sans / bleu marine. |
| CHG-05 | **DOC-04, NFR-06** | Modification | L'application mobile sort de la liste des exclusions par défaut. |
| CHG-06 | Chapitre **23** | Ajout | Chapitre complet « Application mobile ». |
| CHG-07 | Chapitre **24** | Ajout | Report management : templates de documents métier et archivage des pièces émises. |
| CHG-08 | **FIN-01** | Précision | « Logique critique côté base » est conservé et explicité : les invariants comptables restent en PostgreSQL. |
| CHG-09 | **SEC-06** | Adaptation | Authentification par OpenID Connect (Keycloak) ; migration des identités à cadrer. |
| CHG-10 | **NFR-02, NFR-03** | Précision | Conséquences du VPS unique sur la disponibilité et la continuité. |
| CHG-11 | **DEC-06** | Ajout | Décisions d'outillage tranchées : Flyway, Gotenberg, moteur de templates. |
| CHG-12 | **ETAT-01, ECART-01** | Mise à jour | État arrêté au 9 novembre 2026 : audit de couverture des modules. |

### Impact par changement

**CHG-01 — TEC-01.** Impact règles : aucune règle métier modifiée. Impact données : aucune migration de données imposée par ce changement. Impact droits : le contrôle d'accès quitte les seules policies RLS pour être aussi appliqué par l'API (défense en profondeur, voir TEC-09). Impact tests : le chapitre 20 s'applique désormais à l'API autant qu'au client.

**CHG-02 — TEC-08.** Impact exploitation : les responsabilités absorbées aujourd'hui par Lovable Cloud (authentification, TLS, sauvegardes, correctifs du moteur, disponibilité) deviennent explicites et nominatives. Impact recette : la restauration doit être testée, pas seulement prévue.

**CHG-03 — TEC-09.** Impact sécurité : c'est le changement au plus fort risque de régression sur **SEC-01** (isolation). Il exige une recette négative dédiée, reprise de **SEC-07**.

**CHG-04 — UX-01.** Impact visuel uniquement, aucun impact règle/donnée. Impact tests : les captures de recette et le contraste WCAG 2.2 AA (**UX-06**) doivent être revérifiés après application de la charte.

**CHG-05/06 — mobile.** Impact périmètre : nouvelle surface de recette, nouveaux profils utilisateurs concernés. Voir chapitre 23 pour les exclusions maintenues.

**CHG-07 — documents.** Impact données : trois nouveaux objets (modèles, versions, documents émis). Impact droits : édition de modèles réservée, consultation des pièces émises soumise aux permissions existantes. Impact sécurité : nouveau vecteur d'attaque (HTML fourni par l'utilisateur), traité en **DOC-TPL-04**.

**CHG-08 — FIN-01.** Aucun affaiblissement : précision rédactionnelle destinée à empêcher que le portage Java ne déplace les invariants hors de la base.

**CHG-09 — SEC-06.** Impact migration : les mots de passe existants ne sont pas nécessairement importables dans le nouveau fournisseur d'identité. Décision à prendre (voir **DEC-07**).

---

## 03 — Expérience utilisateur commune (révisé)

### UX-01 • Identité (remplace la v1.0)

Interface française, XOF par défaut, éléments plats et tableaux lisibles dans l'esprit SAP/Sage. Formats numériques et dates cohérents ; montants alignés et précision comptable conservée.

**Identité visuelle : charte QUOREICH GROUP** (`docs/charte graphique.pdf`).

| Élément | Valeur imposée |
|---|---|
| Couleur primaire | `#0062db` — soit `213 100% 43%` en HSL |
| Couleur d'accent | `#ff8a51` — soit `20 100% 66%` en HSL |
| Typographie de titres | Montserrat |
| Typographie éditoriale | Playfair Display |
| Signature | « Intelligence Beyond Boundaries » |

Règles d'application :

1. Les couleurs sont exposées comme variables de thème, jamais codées en dur dans les composants (conforme au design system existant).
2. La typographie de corps de texte reste une sans-serif lisible à l'écran pour les tableaux denses ; Montserrat est réservée aux titres et éléments d'identification, Playfair Display aux pages éditoriales (connexion, documentation, en-têtes de documents imprimés).
3. Le contraste WCAG 2.2 AA (**UX-06**) prévaut sur la fidélité stricte à la charte : toute combinaison non conforme est corrigée et documentée.
4. La charte s'applique aussi aux documents imprimés du chapitre 24.

---

## 17 — Architecture et données (révisé)

### TEC-01 • Application (remplace la v1.0)

Architecture cible :

- **Client web** : React 18 (montée vers React 19.3 planifiée, voir TEC-10), TypeScript, Vite, composants de design existants (Tailwind + shadcn/ui) et requêtes mises en cache (TanStack Query).
- **API métier** : Java 25, Spring Boot 4.1.x, Spring Security, Spring Data JPA. Monolithe modulaire organisé par domaine.
- **Base** : PostgreSQL, schéma existant repris comme contrat de départ.
- **Identité** : OpenID Connect via un fournisseur auto-hébergé (Keycloak).
- **Fichiers** : stockage objet S3-compatible (MinIO sur le VPS au démarrage).
- **Documents** : service de rendu PDF isolé (Gotenberg).

La clause « aucun serveur persistant ajouté au client » de la v1.0 est **abrogée** : l'API est un serveur persistant assumé, et le client reste un simple consommateur de contrats HTTP.

Ce que TEC-01 continue d'interdire et qui reste valable :

- aucune règle métier dans le navigateur (**TEC-04**) ;
- aucune clé privée ni secret dans les livrables client (**TEC-07**).

### TEC-08 • Hébergement (nouveau)

Tout est hébergé sur un **VPS unique**, en conteneurs.

| Sujet | Exigence |
|---|---|
| Orchestration | Docker Compose. Aucun orchestrateur tant qu'un besoin de disponibilité n'est pas démontré. |
| Terminaison TLS | Proxy inverse avec certificats renouvelés automatiquement. Aucun service applicatif publié directement. |
| Exposition réseau | Seuls le proxy et le fournisseur d'identité sont publics. Base de données, rendu PDF et stockage objet restent sur le réseau interne. |
| Images | Images non privilégiées, versions figées, scan de vulnérabilités avant déploiement. |
| Secrets | Hors du dépôt et hors des images. Aucun secret dans un export, un journal ou un livrable utilisateur (**TEC-07**). |
| Dimensionnement | À établir selon **NFR-01**, avec un plancher tenant compte de la base, de l'API, du fournisseur d'identité, du rendu PDF et de la supervision. |
| Sauvegardes | Export quotidien + journalisation continue de la base, copie **hors VPS**, rétention définie. |
| Restauration | Exercice de restauration réel exécuté et documenté avant mise en service (**NFR-03**). |

### TEC-09 • Multi-tenant côté serveur (nouveau)

Le maintien de l'isolation par société est une exigence de sécurité, pas un choix d'implémentation.

1. **La source de vérité du contexte société est le jeton d'identité**, jamais un en-tête, un paramètre de requête ou un état du navigateur.
2. **Chaque requête s'exécute dans une transaction qui fixe le contexte société** avant tout accès aux données.
3. **Les politiques RLS existantes sont conservées** et restent actives. L'API se connecte avec un rôle non privilégié : elle ne doit pas pouvoir contourner les politiques par construction.
4. **Les invariants comptables restent dans la base** (voir FIN-01 révisé) : contrainte d'équilibre débit/crédit, immuabilité des écritures comptabilisées, verrous de période, chaîne d'audit.
5. **La consolidation n'élargit jamais l'accès** : toute liste de sociétés demandée est intersectée avec les sociétés autorisées (déjà exigé en **CFO-01**).
6. **Recette négative obligatoire** : requête modifiée, société non autorisée, utilisateur sans rôle, export sensible interdit (reprise de **SEC-07**).

L'absence de support « multi-tenant » de premier ordre dans Spring Boot et Spring Security est un fait : cette exigence est donc implémentée explicitement, testée explicitement, et ne peut pas être considérée comme acquise par le framework.

### TEC-10 • Versions et contrats (nouveau)

| Élément | Exigence |
|---|---|
| Contrats d'API | Documentés en OpenAPI. Le client TypeScript est généré depuis le contrat, jamais écrit à la main. |
| Changements de contrat | Toute rupture touchant web ou mobile est versionnée et documentée (**TEC-06**, **VAL-02**). |
| Migrations de schéma | Versionnées en SQL, rejouables depuis une base vide, testées automatiquement. |
| Versions de plateforme | Java 25 LTS, Spring Boot 4.1.x, PostgreSQL 18.6. Les versions stables sont figées et les préversions exclues. |
| Non-régression | Chaque lot est livré avec ses tests ; aucune régression connue n'est acceptée sans décision explicite. |

---

## 19 — Exigences non fonctionnelles (révisé)

### NFR-02 • Disponibilité (précision)

Le VPS unique constitue un **point de défaillance unique assumé**. L'engagement de disponibilité doit donc être formulé sur cette base et non sur une hypothèse de haute disponibilité.

À contractualiser avant mise en service : plage de maintenance, délai d'intervention, responsable, et comportement annoncé en cas d'indisponibilité du fournisseur d'hébergement.

### NFR-03 • Continuité (précision)

| Élément | Exigence |
|---|---|
| RPO | À fixer. La journalisation continue de la base doit permettre un RPO de l'ordre de quelques minutes. |
| RTO | À fixer. Doit être atteignable par une restauration sur un VPS de remplacement. |
| Sauvegardes | Fréquence, rétention et **emplacement hors VPS** documentés. |
| Essai de restauration | Réalisé, daté, documenté avec son résultat, avant toute mise en service critique. Un plan de sauvegarde non testé n'est pas une garantie. |

### NFR-05 • Observabilité (précision)

Erreurs de calcul, accès refusés, traitements échoués et délais surveillés **sans enregistrer de secrets ni de données personnelles sensibles**. Chaque journal porte un identifiant de corrélation permettant de relier une action utilisateur à ses traitements serveur. Toute alerte d'exploitation a un acteur responsable nommé.

---

## 23 — Application mobile (nouveau chapitre)

### MOB-01 • Statut et périmètre

L'application mobile **est incluse au périmètre** (elle était exclue par défaut en DOC-04 ; cette exclusion est levée).

Technologie : Expo SDK 58, React Native 0.88, React 19.3, TypeScript. La compatibilité des versions est celle imposée par le SDK Expo ; les modules natifs sont alignés par les outils Expo.

L'application mobile est un **client de l'API**, au même titre que le web : elle ne contient aucune règle métier (**TEC-04**).

### MOB-02 • Authentification

Connexion par OpenID Connect avec le même fournisseur d'identité que le web (flux avec code d'autorisation et vérification PKCE). Aucun stockage de mot de passe sur l'appareil. Jeton révocable à distance.

La sélection de société est obligatoire après connexion et ne peut jamais être contournée par une requête modifiée (**SEC-01**).

### MOB-03 • Périmètre fonctionnel de la première version

| Inclus | Exclu (nécessite une décision explicite) |
|---|---|
| Connexion et sélection de société | Saisie comptable, factures, journaux |
| Consultation des alertes, marquage lu/résolu selon droits | Création de documents métier |
| Approbations : demande d'achat, commande, note de frais | Paie et données RH sensibles |
| Position de trésorerie et indicateurs CFO en lecture | Reporting avancé et paramétrage |
| Consultation des documents émis (chapitre 24) | Mode hors ligne |

Le mobile de la première version est un **outil de consultation et de validation**, pas un second poste de saisie.

### MOB-04 • Hors ligne

**Le mode hors ligne n'est pas inclus.** DOC-04 le prévoyait exclu ; cette exclusion est maintenue explicitement. Son inclusion changerait la nature du projet (synchronisation, résolution de conflits, idempotence côté appareil) et exige une décision et un lot distincts.

Sans réseau, l'application doit afficher un état explicite et une reprise manuelle, jamais des données périmées présentées comme à jour (**UX-05**).

### MOB-05 • Plateformes

**Android en priorité.** La première version est livrée et recettée sur Android. iOS est un lot ultérieur, sur décision explicite, en tenant compte de la chaîne de build et du compte développeur requis.

### MOB-06 • Recette

La matrice **REC-04** s'applique intégralement au mobile : succès, absence de droit, autre société, entrée invalide, répétition, interruption, lecture après rechargement. S'y ajoutent : perte de connexion en cours d'action, refus de permission native, et comportement après expiration du jeton.

### MOB-07 • Design system partagé

Le mobile ne réutilise pas les composants web. Ce qui est partagé :

1. **les jetons de design** (couleurs de la charte, typographies, espacements, rayons) ;
2. **les contrats d'API** générés depuis OpenAPI ;
3. **les libellés métier français**.

Les composants sont implémentés séparément côté web et côté natif. Le partage se fait par les jetons et les contrats, pas par le code d'interface.

---

## 24 — Documents imprimés et report management (nouveau chapitre)

### DOC-TPL-01 • Objectif

Fournir une gestion de modèles de documents permettant de produire des pièces métier imprimables, mises en page selon la charte (**UX-01**), sans intervention d'un développeur pour chaque changement de présentation.

Documents concernés au minimum : demande d'achat, bon de commande, bon de réception, bon de sortie, facture client, facture fournisseur, rapport de clôture de trésorerie.

### DOC-TPL-02 • Modèle de données

Trois objets, tous rattachés à une société.

| Objet | Rôle |
|---|---|
| **Modèle de document** | Identité du modèle : société, type de document, nom, version courante. |
| **Version de modèle** | Contenu HTML/CSS, actifs (logo, polices) et empreinte de contenu. Une version publiée est **immuable**. |
| **Document émis** | Pièce produite : référence, version de modèle utilisée, instantané des données, empreinte des données, fichier PDF et son empreinte, moteur et version de rendu, statut, remplacement éventuel. |

Règles :

1. Toute modification d'un modèle crée une **nouvelle version** ; aucune version publiée n'est éditée.
2. Un document émis est **immuable**. Une annulation ou un remplacement crée une nouvelle pièce qui référence la précédente.
3. L'instantané des données imprimées est conservé avec son empreinte : c'est la preuve de ce qui a été émis.
4. La version du moteur de rendu est conservée : elle explique les différences de rendu dans le temps.

### DOC-TPL-03 • Rendu

Rendu en deux étapes : production du HTML à partir du modèle et des données, puis conversion en PDF par un service de rendu isolé.

Exigences :

1. **Le PDF final est archivé**, pas régénéré. Réimprimer un document ancien ne doit jamais réutiliser un modèle plus récent.
2. Les polices de la charte sont **incorporées** au PDF.
3. Le format de conservation visé est PDF/A.
4. Le rendu s'exécute hors du processus HTTP principal : une conversion lente ne bloque pas l'API.

### DOC-TPL-04 • Sécurité des modèles

Les modèles sont édités par des utilisateurs : leur contenu est une **entrée non fiable**.

1. **Aucun moteur de template autorisant l'évaluation d'expressions** ne doit traiter un contenu fourni par une société. Un moteur d'expressions sur du HTML utilisateur ouvre une exécution de code côté serveur. Le rendu se fait par substitution de jetons dans un contexte figé, avec un jeu de champs autorisés par type de document.
2. Le HTML produit par l'éditeur est **assaini côté serveur** avant rendu : scripts, gestionnaires d'événements, cadres, ressources externes et URL privées sont supprimés.
3. Le service de rendu s'exécute **sans accès réseau sortant**, avec JavaScript désactivé, taille de corps, délais et file d'attente bornés.
4. L'édition de modèles est soumise à permission (**SEC-02**) et **tracée** (**SEC-05**) : qui, quand, quelle version, quel motif.
5. L'accès aux documents émis respecte le périmètre société et les permissions existantes ; liens de téléchargement signés et de courte durée.

### DOC-TPL-05 • Archivage et conservation

| Élément | Exigence |
|---|---|
| Emplacement du PDF | Stockage objet, jamais dans la base pour les volumes courants. |
| Emplacement des métadonnées | Base, pour la recherche, les droits et l'audit. |
| Immutabilité | Objet non réécrit ; le stockage objet doit permettre de détecter une altération. |
| Conservation | Durées distinctes pour pièces, exports et journaux d'audit (**NFR-04**), à valider avec le référent comptable. |
| Sauvegarde | Les modèles et leurs actifs ont la même rétention que les PDF émis. |

### DOC-TPL-06 • Recette

1. Publier une version de modèle, émettre un document, modifier le modèle, **réimprimer** : le document réémis est identique à l'original ou porte explicitement un nouveau numéro et un remplacement.
2. Un modèle contenant un script ou une ressource externe est **refusé ou neutralisé** ; aucun script ne s'exécute au rendu.
3. Un utilisateur sans permission d'édition ne peut ni créer ni publier de version.
4. Une société ne peut ni voir ni imprimer un document d'une autre société, même en modifiant la requête.
5. Le PDF produit contient les polices de la charte et respecte la mise en page du modèle publié.

---

## 22 — Décisions ouvertes (mise à jour)

### DEC-06 • Outillage technique — tranchée le 9 novembre 2026

| Sujet | Décision | Motif |
|---|---|---|
| Migrations de schéma | **Flyway Community 13.x** | Apache 2.0 sans restriction d'usage ; migrations en SQL brut, adaptées à la reprise verbatim des fonctions, triggers et politiques existants. Liquibase Community 5.x est gratuit mais sous Functional Source License (source-available, non OSI) : utilisable en interne, mais impose une revue et une date de conversion à documenter. |
| Rendu PDF | **Gotenberg 9.2** (MIT) | Rendu Chromium : CSS moderne complet, polices de marque, en-têtes et pieds de page, PDF/A. Service unique, sans base, adapté à un VPS unique. |
| Substitution des modèles | Moteur à jetons, **sans évaluation d'expression** | Empêche l'exécution de code via un modèle fourni par une société (DOC-TPL-04). |
| Éditeur de modèles | Éditeur HTML WYSIWYG embarqué dans le back-office, jeu de composants verrouillé | Permet l'édition métier sans développeur, tout en maîtrisant le HTML produit. |
| Supervision | OpenTelemetry, Prometheus, Grafana, alertes | Répond à NFR-05 sans multiplier les services sur un VPS unique. |

### DEC-07 • Migration des identités (ouverte)

Les mots de passe actuellement stockés ne sont pas nécessairement importables dans le fournisseur d'identité cible. Trois options à arbitrer : réinitialisation forcée à la bascule, import si un mécanisme compatible existe, ou coexistence temporaire des deux fournisseurs.

Critère de décision : ne jamais transiger sur **SEC-06**, et prévenir les utilisateurs avant la bascule.

### DEC-08 • RPO/RTO et engagement de service (ouverte)

À fixer avec le client (**NFR-02**, **NFR-03**, **DEC-05**). Aucun engagement ne doit être annoncé avant que l'essai de restauration ait été réalisé sur le VPS cible.

### DEC-09 • Plateforme mobile secondaire (ouverte)

Date et périmètre d'une éventuelle version iOS (**MOB-05**).

---

## 21 — État actuel (mise à jour du 9 novembre 2026)

### ETAT-03 • Couverture réelle des modules

L'audit des sources, au 9 novembre 2026, donne la répartition suivante sur 111 pages.

| État | Constat |
|---|---|
| Modules complets et câblés jusqu'à l'écran | AR, AP, ventes, RH/paie, CRM, immobilisations, noyau GL, flux achats |
| Modules sans aucune écriture reliée à l'écran | Budget, projets, dépenses, risques, référentiels de stocks, création de comptes et transactions de trésorerie |
| Pages présentant des données statiques | 14 pages métier, 18 pages dites « déguisées » (elles n'appellent qu'un contrôle de rôle) et 6 pages partiellement statiques |
| Mutations existantes mais jamais branchées | 18 points d'entrée d'écriture |

Cette répartition **confirme les écarts** déjà relevés en ECART-01 et ECART-02, et les étend. Elle ne constitue pas une régression : ces modules étaient en cours. Elle a une conséquence sur le séquencement (LOT-01 révisé) : les modules incomplets ne se **portent** pas, ils se **construisent**.

### LOT-01 • Séquencement (précision)

Les modules déjà complets peuvent être portés avec exigence de parité. Les modules incomplets sont développés directement sur la cible, avec les écrans branchés dessus. Aucun lot ne peut être accepté sur la seule présence de pages (**REC-06**).

---

## VAL-03 • Portée de la présente révision

Cette v1.1 ne vaut pas validation du plan de bascule. Elle acte les changements de périmètre et d'architecture. Le séquencement, les critères de sortie et les modalités d'exécution sont décrits dans `docs/PLAN-BASCULE-JAVA.md`, qui doit être approuvé séparément.

Les approbations de **VAL-01** restent à recueillir : aucun accord n'est présumé.