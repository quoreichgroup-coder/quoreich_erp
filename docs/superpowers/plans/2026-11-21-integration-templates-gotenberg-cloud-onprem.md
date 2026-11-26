# Plan d’intégration des modèles de documents et de Gotenberg

> **Pour les agents d’implémentation :** utiliser `superpowers:executing-plans` pour suivre ce plan tâche par tâche. Chaque étape est suivie avec une case à cocher.

**Objectif :** Fournir aux entreprises le même circuit de modèles et d’archives PDF dans QERP cloud et sur site, avec un éditeur visuel sûr et des modèles HTML/CSS maintenus par les développeurs.

**Architecture :** Conserver le contrat métier et le schéma QERP communs aux deux déploiements. Un contrat d’édition partagé orchestre les demandes, tandis que le stockage d’archives et l’accès au moteur Gotenberg sont adaptés à chaque environnement. Les développeurs livrent des modèles de référence versionnés avec l’application ; les entreprises peuvent créer et ajuster leurs modèles au moyen de champs et composants structurés, que le serveur transforme en HTML avant rendu.

**Technologies :** React/TypeScript, API Java/Spring, PostgreSQL, migrations Flyway et jumelles Supabase, Supabase Edge en compatibilité cloud, Gotenberg 9.2, Docker et archives privées.

**Spécification :** `docs/audit-erp/30-documents-modeles-et-archives.md` ; circuit PO déjà décrit dans `docs/superpowers/plans/2026-11-20-po-document-editions.md`.

## Hypothèses de travail

- « HTML/CSS pour les développeurs » signifie que les modèles de référence sont édités dans le dépôt, revus et livrés avec une version de QERP. Les utilisateurs ayant le droit requis peuvent en dériver une variante visuelle dans QERP. Si le propriétaire voulait aussi un éditeur HTML/CSS dans QERP, ce serait un autre périmètre avec bac à sable et politique de sécurité spécifiques.
- V143 a raccordé les commandes d’achat au circuit d’édition et V144 a établi le modèle par défaut par société et type. Ne pas dupliquer ces migrations : vérifier les versions dans les deux environnements avant toute évolution.
- La sélection cloud ou sur site est un choix de déploiement/provisionnement d’entreprise. Ce n’est pas un commutateur qui déplace implicitement ses données entre deux bases.
- Les anciennes pièces émises demeurent immuables ; changer ou déployer un modèle ne modifie ni leur instantané ni leur PDF archivé.

## Contraintes globales

- Même schéma métier, règles d’accès, contrat d’API et comportement utilisateur dans les deux modes.
- Chaque migration SQL destinée aux deux modes a une jumelle Supabase équivalente et vérifiée.
- Toute lecture/écriture reste limitée aux sociétés accessibles et aux permissions du type de document.
- Le HTML/CSS arbitraire fourni par une entreprise, les scripts, URL, iframes et ressources distantes ne sont jamais exécutés.
- Le rendu utilise Gotenberg 9.2, un réseau privé, des limites de temps et de taille, des polices embarquées et le profil PDF/A convenu.
- Une réimpression sert les octets archivés et vérifie leur empreinte ; elle ne relance pas une conversion.
- Les erreurs de rendu ou de stockage sont visibles et relançables explicitement ; pas de retries automatiques côté CFO ou des lectures connexes.
- Toute consolidation multi-société intersecte les sociétés demandées avec `get_accessible_tenants`; elle ne contourne pas les permissions pour agréger des données cloud et on-prem.

## Fichiers et frontières à respecter

- `src/components/DocumentTemplatesPanel.tsx` : liste, configuration, édition visuelle et aperçu des brouillons.
- `src/hooks/use-document-editions.ts` : types et accès au contrat commun ; éviter de faire diverger les parcours selon l’environnement.
- `src/components/` et les composants de document existants : parcours d’émission, statut et archives dans les modules métier.
- `services/api/` : routes Java `/api/v1/document-templates` et `/api/v1/document-editions`, orchestration et adaptateurs de stockage/rendu.
- `supabase/functions/document-render/` : adaptateur cloud temporaire compatible avec les mêmes RPC et le même cycle d’état.
- `supabase/migrations/` et `services/api/src/main/resources/db/migration/` : jumelles SQL et Flyway ; inventaire V143/V144 avant ajout.
- `infra/` et configuration de déploiement : moteur privé, polices, secrets et limites par environnement ; jamais exposer Gotenberg directement.
- `docs/` : catalogue de composants/champs, conventions de contribution développeur, matrice de parité et procédure d’exploitation.

## Points de revue prioritaires

- Même demande simultanée, panne, redémarrage de processus et relance ne perdent pas ni ne dupliquent l’édition : couvrir la reprise d’un travail durable dans la tâche 3.
- Aperçu ou rendu avec texte HTML malveillant, champs absents, accents, polices ou page atypique reste sûr et lisible : couvrir dans les tâches 1 et 2.
- Utilisateur sans droit, autre société ou mauvais type de document ne peut ni modifier ni récupérer l’archive : couvrir dans les tâches 1, 3 et 5.
- Déploiement d’un nouveau modèle de référence ne remplace pas un modèle publié ou un document déjà émis : couvrir dans les tâches 1 et 5.
- Gotenberg, réseau ou stockage indisponible dans un des modes ne produit pas de PDF présenté comme valide : couvrir dans les tâches 3 et 4.

---

### Tâche 1 : Formaliser et versionner les modèles de référence

**Fichiers :**
- Créer : catalogue des modèles et schémas de présentation dans `docs/` et le répertoire de modèles de documents du dépôt, après confirmation du chemin canonique existant.
- Modifier : `src/components/DocumentTemplatesPanel.tsx` et types partagés uniquement si le schéma existant ne peut représenter les blocs retenus.
- Test : tests unitaires du registre de modèles et de la génération HTML côté serveur.

**Contrats :**
- Entrée : `doc_type`, identifiant stable, version, présentation structurée et métadonnées de compatibilité.
- Sortie : modèle de référence immuable, valide pour le même `doc_type` et installable de façon idempotente par société.

- [ ] **Étape 1 :** Ajouter les tests du catalogue couvrant identifiant/version stables, installation répétée, type inconnu et migration d’une présentation ancienne.
- [ ] **Étape 2 :** Confirmer par les tests qu’un déploiement n’écrase pas la version publiée personnalisée par une société.
- [ ] **Étape 3 :** Définir le schéma de blocs partagés (en-tête, identité des parties, lignes, totaux, notes, pied, page) et les champs autorisés pour chaque type de document.
- [ ] **Étape 4 :** Ajouter les modèles PO « standard » et « référence PO0004821 » au registre versionné en conservant leurs orientations et règles déjà livrées.
- [ ] **Étape 5 :** Documenter l’ajout, la revue visuelle, la compatibilité et le retrait d’une version de modèle.
- [ ] **Étape 6 :** Vérifier les tests de catalogue et de rendu, sans toucher aux migrations V143/V144.

### Tâche 2 : Unifier l’éditeur visuel et l’aperçu

**Fichiers :**
- Modifier : `src/components/DocumentTemplatesPanel.tsx`, `src/hooks/use-document-editions.ts` et composants de formulaire/aperçu associés.
- Créer : composants réutilisables de palette de blocs, propriétés, état brouillon et aperçu si aucun composant équivalent n’existe.
- Test : tests composants pour édition, validation, aperçu, droits et clavier.

**Contrats :**
- Entrée : schéma structuré et champs/variantes exposés par le catalogue (Tâche 1).
- Sortie : brouillon de présentation validé enregistré par le même contrat d’API/RPC dans cloud et sur site.

- [ ] **Étape 1 :** Écrire les tests d’édition des blocs, propriétés de marque, taille de page/orientation autorisées, annulation et sauvegarde.
- [ ] **Étape 2 :** Écrire un test prouvant que l’aperçu reflète le brouillon courant sans publier ni créer une archive.
- [ ] **Étape 3 :** Remplacer les champs spécifiques dispersés par l’éditeur visuel commun, avec palette, propriétés contextuelles, aperçu et validation explicite.
- [ ] **Étape 4 :** Afficher les composants/champs permis selon le type d’objet ; une valeur absente est omise ou rendue vide de manière cohérente, jamais inventée.
- [ ] **Étape 5 :** Isoler l’aperçu, échapper les valeurs et neutraliser les ressources actives ; vérifier l’accessibilité clavier et le retour de focus après fermeture de dialogue.
- [ ] **Étape 6 :** Vérifier qu’une préférence par défaut s’applique à tous les documents du même type et de la même société, sans modifier les éditions antérieures.

### Tâche 3 : Rendre les éditions durables et récupérables

**Fichiers :**
- Modifier : orchestration dans `services/api/`, worker `supabase/functions/document-render/` et RPC SQL de cycle de vie uniquement si les contrats actuels ne suffisent pas.
- Créer : migration Flyway et jumelle Supabase seulement si une file persistante/lease/récupération manque au schéma actuel.
- Test : tests Java, SQL et Edge pour concurrence, reprise, échec et relance.

**Contrats :**
- Entrée : demande authentifiée existante `request_document_edition` ou son équivalent par type.
- Sortie : un état durable `queued/rendering/ready/failed`, un seul propriétaire de travail à la fois, relance explicite sur le même instantané.

- [ ] **Étape 1 :** Écrire un test d’intégration qui arrête ou simule la perte du worker après revendication, puis vérifie la reprise après expiration de lease.
- [ ] **Étape 2 :** Vérifier les garanties de concurrence/idempotence actuelles et consigner le résultat avant de créer une migration.
- [ ] **Étape 3 :** Si la reprise durable est absente, ajouter lease, compteur/timestamps utiles et revendication atomique ; fournir une jumelle Supabase équivalente et réversible selon les conventions du dépôt.
- [ ] **Étape 4 :** Garder les mêmes RPC et règles métier dans Java et Edge ; l’Edge reste un adaptateur cloud, pas une seconde définition du cycle d’état.
- [ ] **Étape 5 :** Ajouter la récupération d’un travail bloqué après arrêt, l’idempotence au moment de l’archivage et l’erreur visible après épuisement des limites.
- [ ] **Étape 6 :** Vérifier double demande, worker interrompu, relance explicite, concurrence et régression des factures/PO.

### Tâche 4 : Garantir une interface renderer et stockage par déploiement

**Fichiers :**
- Modifier : client Gotenberg Java, configuration `infra/`, gestion d’archives et adaptateur de stockage cloud.
- Créer : tests de contrat commun renderer/storage et documentation d’exploitation cloud/on-prem.
- Test : tests de contrat avec Gotenberg contrôlé ou stub HTTP, plus vérification manuelle des deux profils de déploiement.

**Contrats :**
- Renderer : HTML validé + paramètres de page → PDF conforme ou erreur typée ; aucun accès sortant.
- Archive : flux PDF validé + tenant/id → chemin privé immuable, taille et SHA-256 ; lecture vérifiant empreinte et permissions.

- [ ] **Étape 1 :** Définir le contrat renderer partagé et couvrir taille maximale, délai, erreur HTTP, PDF invalide et réponse trop volumineuse.
- [ ] **Étape 2 :** Définir les paramètres identiques des environnements : version Gotenberg 9.2, PDF/A, polices embarquées, locale, fuseau, marges, limites et politique réseau.
- [ ] **Étape 3 :** Encapsuler les différences cloud/local derrière l’adaptateur de stockage existant ou une interface commune ; chemins générés côté serveur et aucune réécriture.
- [ ] **Étape 4 :** Fournir les secrets, volumes de polices et URL privées via la configuration de déploiement ; aucun secret ou endpoint privé dans React.
- [ ] **Étape 5 :** Documenter santé, métriques, logs corrélés par identifiant d’édition, sauvegarde/rétention et procédure de reprise.
- [ ] **Étape 6 :** Vérifier le même HTML de référence dans cloud et on-prem, accès privé à Gotenberg, PDF/A, polices incorporées, téléchargement et empreinte d’archive.

### Tâche 5 : Rendre les contrats UI/API équivalents

**Fichiers :**
- Modifier : `src/hooks/use-document-editions.ts`, routes OpenAPI et contrôleurs/services Java, ainsi que Edge si encore utilisé.
- Créer : vérifications de contrat API exécutées contre les deux adaptateurs.
- Test : tests d’intégration autorisation, modèle par défaut, aperçu, demande, statut, relance et téléchargement.

**Contrats :**
- Les mêmes routes/DTO et erreurs métier sont disponibles en mode cloud et sur site pour les fonctionnalités migrées.
- La sélection par défaut est résolue côté serveur par société + `doc_type`, avec autorisation vérifiée.

- [ ] **Étape 1 :** Comparer OpenAPI, API Java et Edge aux contrats actuels et ajouter des tests d’équivalence pour chaque opération document.
- [ ] **Étape 2 :** Centraliser le choix du client API dans la configuration d’environnement ; le composant métier ne branche pas sur des comportements différents.
- [ ] **Étape 3 :** Ajouter l’aperçu du brouillon et les opérations d’édition manquantes au contrat sans exposer de chemin ou d’identifiants de stockage sensibles.
- [ ] **Étape 4 :** Vérifier les permissions `reports.templates` et droits métier par type sur chaque lecture/écriture, y compris les téléchargements.
- [ ] **Étape 5 :** Vérifier les contrats pour `purchase_order`, `ar_invoice` et chaque type déjà raccordé ; assurer que les paramètres/erreurs restent compatibles.

### Tâche 6 : Déployer progressivement les modules et choisir le mode d’entreprise

**Fichiers :**
- Modifier : provisioning/enregistrement de l’entreprise et configuration du module si ces capacités existent déjà ; ne pas ajouter un simple toggle de base de données dans l’interface utilisateur.
- Créer : matrice de maturité cloud/on-prem, runbook de migration d’un module et procédures de transfert d’entreprise.
- Test : recette de provisioning et d’import/export sur environnement de préproduction.

**Contrats :**
- Une entreprise est associée à un déploiement autorisé ; un module migré conserve le même API/schema et peut être activé selon la matrice de capacité.
- Le transfert entre déploiements est une opération explicite, auditée, vérifiée et réversible, couvrant base et archives.

- [ ] **Étape 1 :** Décrire la source de vérité de l’affectation entreprise → cloud/on-prem, ses propriétaires, la résolution d’URL et le contrôle d’accès.
- [ ] **Étape 2 :** Définir la matrice par module : version de schéma, API, capacités, contraintes, état de migration et compatibilité de version.
- [ ] **Étape 3 :** Documenter le protocole de transfert : gel/instantané, pièces et archives, empreintes, import, validation, bascule, fenêtre de retour arrière et audit.
- [ ] **Étape 4 :** Vérifier qu’aucune consolidation CFO ne joint les bases directement ou n’élargit l’accès ; les requêtes restent limitées aux sociétés accessibles via le contrat sécurisé.
- [ ] **Étape 5 :** Exécuter une recette sur une société non productive avant de proposer la bascule d’une société réelle.

### Tâche 7 : Recette de parité et critères de sortie

**Fichiers :**
- Modifier : documentation d’exploitation et matrice de capacité cloud/on-prem.
- Test : suite de contrat, sécurité et rendu sur les deux environnements.

- [ ] **Étape 1 :** Préparer une fiche de recette avec un PO standard, le PO de référence, une facture et au moins un document du prochain module migré.
- [ ] **Étape 2 :** Comparer l’aperçu, le PDF, les métadonnées, les droits et les statuts dans les deux modes, en tenant compte des différences métier explicitement documentées.
- [ ] **Étape 3 :** Vérifier l’isolation inter-société, utilisateur lecteur, droits manquants, contenu malveillant, champs vides, panne du renderer, panne de stockage et relance.
- [ ] **Étape 4 :** Vérifier qu’une édition archivée conserve le même identifiant, la même version de modèle, le même snapshot et les mêmes octets après modification du modèle et des données source.
- [ ] **Étape 5 :** Publier la matrice de résultats et n’activer un module dans un mode que lorsque migrations, API, renderer, archive, sauvegarde et support sont opérationnels.

## Ordre de livraison suggéré

1. Tâche 1 puis tâche 2 : rendre le modèle développeur et l’édition visuelle cohérents.
2. Tâche 3 puis tâche 4 : garantir la reprise durable et la parité de rendu/archives.
3. Tâche 5 : aligner l’expérience et le contrat API des deux modes.
4. Tâche 6 puis tâche 7 : organiser la migration progressive des modules et valider le choix cloud/on-prem.

## Hors périmètre de cette première intégration

- Éditeur de code HTML/CSS arbitraire accessible aux utilisateurs d’entreprise.
- Déplacement silencieux ou automatique d’une entreprise entre bases cloud et on-prem.
- Réémission automatique des documents historiques lors d’un déploiement de modèle.
- Activation du rendu cloud tant que l’URL HTTPS Gotenberg, les secrets et la fonction Edge ne sont pas opérationnels et vérifiés.
