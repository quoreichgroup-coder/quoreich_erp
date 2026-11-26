# PROMPT — AUDIT, ANALYSE DES INSUFFISANCES ET AMÉLIORATION DU MODULE RH & PAIE DE QERP

## 1. Contexte et objectif

Tu interviens en tant qu'architecte logiciel senior, expert ERP, consultant fonctionnel RH/Paie et développeur full-stack.

Le projet QERP repose sur une architecture comprenant notamment :

- **Frontend :** React JS
- **Backend :** Spring Boot
- **Base de données :** PostgreSQL

**Mission : analyser en profondeur le module RH & Paie existant, identifier ses insuffisances fonctionnelles et techniques, puis implémenter les améliorations justifiées.**

L'objectif n'est pas de reconstruire inutilement le module, mais de le rendre plus flexible, configurable, fiable, évolutif et conforme aux principes d'un ERP professionnel.

S'inspirer des bonnes pratiques de SAP HCM / SuccessFactors, Sage Paie & RH, Sage X3 et Odoo, sans copier aveuglément leur fonctionnement.

La première localisation métier concerne le Burkina Faso, mais l'architecture doit permettre une extension multi-pays.

## 2. Phase 1 — Audit complet de l'existant

Explorer réellement le code source, les pages, les API, les services métier, les entités et le schéma PostgreSQL.

Analyser particulièrement les fonctionnalités suivantes :

1. Règles de paie par pays.
2. Rubriques et éléments de rémunération.
3. Comptabilisation de la paie.
4. Gestion des matricules.
5. Référentiels RH et mouvements.
6. Droits, rôles et autorisations.
7. Gestion des employés et contrats.
8. Gestion des primes, indemnités et retenues.
9. Absences, congés et heures supplémentaires.
10. Cycles de paie, bulletins et paiements.
11. Importation et exportation des données.
12. Audit, historique et validation des opérations.

Pour chaque fonctionnalité, identifier :

- Ce qui existe et fonctionne réellement.
- Ce qui existe uniquement au niveau de l'interface.
- Ce qui est codé en dur.
- Ce qui est configurable par l'utilisateur.
- Ce qui manque.
- Les éventuelles erreurs de conception.
- Les risques fonctionnels, comptables ou réglementaires.
- Les dépendances avec les autres modules QERP.

**Important : ne pas déclarer une fonction absente sans avoir vérifié son implémentation dans le code et les API.**

## 3. Phase 2 — Analyse des insuffisances fonctionnelles

### A. Flexibilité des rubriques

Vérifier si QERP permet de créer librement :

- Salaires de base et sursalaires.
- Primes et gratifications.
- Indemnités.
- Retenues salariales.
- Cotisations patronales.
- Bases de calcul.
- Rubriques intermédiaires et de cumul.
- Rubriques conditionnelles.
- Rubriques propres à une société, un établissement ou une catégorie de salariés.

Le moteur doit pouvoir utiliser plusieurs méthodes de calcul :

- Montant fixe.
- Pourcentage d'une base.
- Quantité × taux.
- Formule personnalisée sécurisée.
- Barème progressif.
- Calcul plafonné.
- Calcul conditionnel.
- Calcul proratisé.

Chaque rubrique doit gérer les dates d'effet, la priorité de calcul, les dépendances et les règles d'assujettissement fiscal et social.

### B. Moteur de calcul

Vérifier que les calculs ne sont pas dispersés dans des composants React ou codés en dur dans les services backend.

Si nécessaire, concevoir un moteur centralisé permettant :

- L'évaluation des formules avec un langage contrôlé.
- La détection des dépendances circulaires.
- La gestion des arrondis.
- Les cumuls mensuels et annuels.
- Les simulations et recalculs.
- Les rappels et régularisations.
- Les changements de règles avec dates d'effet.
- La conservation des règles appliquées aux anciens bulletins.

Ne jamais exécuter directement du code utilisateur arbitraire pour calculer une rubrique.

### C. Paramétrage légal

Analyser la prise en charge des éléments suivants :

- CNSS et plafonds de cotisation.
- IUTS et tranches progressives.
- Fonds de soutien patriotique.
- Taxes et contributions patronales.
- Régimes particuliers.
- Exonérations.
- Abattements.
- Charges de famille.
- Déclarations réglementaires.

La configuration légale doit être sourcée, datée, versionnée et validée par une personne habilitée.

**Ne pas inventer de taux ou de règles juridiques. Ne pas activer une règle fiscale non validée.**

### D. Intégration RH et Paie

Évaluer comment les changements RH influencent automatiquement la paie :

- Embauche.
- Promotion.
- Mutation.
- Modification de salaire.
- Modification de contrat.
- Absences et congés.
- Suspension.
- Reprise de service.
- Départ d'un employé.

Chaque mouvement doit conserver son historique, ses pièces justificatives, son circuit d'approbation et sa date d'effet.

### E. Comptabilisation

Vérifier la capacité à configurer les comptes SYSCOHADA et à générer les écritures comptables à partir des résultats de paie.

Prévoir un mapping configurable par société, établissement, rubrique, catégorie de personnel et axe analytique.

Prendre en charge les contrôles d'équilibre, les écritures de contrepassation et la prévention des doubles comptabilisations.

### F. Importation et mapping

Analyser la possibilité d'importer et de mettre à jour les référentiels et données à partir de fichiers Excel/CSV.

Prévoir :

- Modèles téléchargeables.
- Mapping des colonnes.
- Prévisualisation.
- Validation des données.
- Détection des doublons.
- Mode simulation avant importation.
- Journal des erreurs.
- Importation en masse sécurisée.
- Historique des opérations.

Les données existantes ne doivent jamais être écrasées silencieusement.

## 4. Phase 3 — Audit technique et architectural

Vérifier :

- Structure des composants React.
- Organisation des contrôleurs et services Spring Boot.
- Cohérence des DTO et validations.
- Modèle de données PostgreSQL.
- Relations entre employés, contrats, mouvements, rubriques et bulletins.
- Isolation multi-société.
- Contrôle d'accès côté backend.
- Performance des traitements de masse.
- Transactions et concurrence.
- Gestion des erreurs.
- Tests existants.
- Traçabilité des calculs.
- Protection des données personnelles et salariales.

Identifier les duplications, la dette technique, les responsabilités mal séparées et les éventuels problèmes de performance.

## 5. Phase 4 — Architecture cible et améliorations

À partir des constats réels, proposer et implémenter progressivement les améliorations nécessaires.

Privilégier une architecture modulaire comprenant :

1. Configuration des règles légales.
2. Gestion des rubriques.
3. Gestion des bases de calcul et formules.
4. Gestion des contrats et éléments salariaux.
5. Collecte des variables de paie.
6. Moteur de calcul.
7. Simulation et contrôle des bulletins.
8. Validation et clôture des cycles.
9. Comptabilisation.
10. Déclarations, rapports et exports.
11. Importation avec mapping.
12. Historique et audit.

Les paramètres métiers doivent être modifiables depuis l'interface, sans intervention systématique d'un développeur.

Prévoir une séparation claire entre les règles globales, les règles par pays, les règles par société et les paramètres individuels.

## 6. Phase 5 — Implémentation contrôlée

Après l'audit :

- Corriger immédiatement les anomalies mineures clairement identifiées et couvertes par des tests.
- Améliorer les validations et messages d'erreur.
- Réutiliser les services et composants existants lorsque c'est pertinent.
- Mettre en place les migrations nécessaires sans perte de données.
- Implémenter progressivement les fonctionnalités manquantes.
- Préserver la compatibilité des API lorsque cela est possible.
- Ne pas supprimer les fonctionnalités existantes sans justification.
- Ne pas écraser les paramètres de paie déjà enregistrés.
- Ne pas modifier les bulletins clôturés.
- Ne pas appliquer automatiquement des changements réglementaires en production.

Pour toute modification importante du schéma ou du moteur de calcul, réaliser une migration sécurisée et disposer d'une procédure de retour arrière.

## 7. Phase 6 — Tests et validation

Créer ou compléter les tests unitaires, d'intégration et E2E.

Tester au minimum :

- Création et modification des rubriques.
- Calcul des gains et retenues.
- Plafonnement CNSS.
- Barème progressif IUTS.
- Proratisation.
- Gestion des dates d'effet.
- Simulation de bulletin.
- Modification rétroactive d'un contrat.
- Régularisation.
- Modification d'un salarié après clôture.
- Importation de données valides et invalides.
- Droits et autorisations.
- Comptabilisation équilibrée.
- Absence de doublons.
- Reproductibilité des anciens bulletins.

Les calculs légaux doivent être comparés à des cas de référence vérifiés avant leur mise en production.

## 8. Livrables attendus

Fournir un rapport structuré comprenant :

### A. Diagnostic de l'existant

Tableau : module, fonctionnalité, état actuel, insuffisance, criticité, recommandation.

### B. Analyse des causes

Expliquer pourquoi chaque limitation existe, avec les fichiers, classes, services ou tables concernés.

### C. Architecture cible

Décrire les modules, relations, règles métier, API et modifications du modèle de données.

### D. Plan d'amélioration

Classer les évolutions par priorité :

- **P0 :** anomalies critiques et risques de calcul.
- **P1 :** moteur de paie, rubriques et bases de calcul.
- **P2 :** intégration RH, comptabilisation, imports et workflows.
- **P3 :** fonctionnalités avancées, reporting et multi-pays.

### E. Réalisations

Lister précisément les fichiers modifiés, migrations créées, tests exécutés et résultats obtenus.

### F. Limites restantes

Indiquer les fonctionnalités non terminées, les décisions métier en attente et les points nécessitant une validation réglementaire.

## 9. Règle finale

Ne te limite pas à produire un rapport théorique.

**Analyse le système existant, démontre les insuffisances réelles, définis les corrections appropriées, puis améliore effectivement le code lorsque cela est justifié et réalisable sans compromettre les données.**

Ne fais aucune refonte purement esthétique ou modification massive sans nécessité démontrée.

Le résultat attendu est un module RH & Paie QERP professionnel, évolutif, configurable et fiable, capable de fonctionner de manière cohérente avec les autres modules de l'ERP.

Commence maintenant par l'inspection du dépôt et du modèle de données, puis exécute le plan de correction par priorité, avec tests et compte rendu de chaque modification.
