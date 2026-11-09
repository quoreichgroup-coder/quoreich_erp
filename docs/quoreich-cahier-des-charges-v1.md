# QUOREICH — Cahier des charges complet
Version 1.0 — 3 novembre 2026. Cadrage à valider.

## 01 — Objet, périmètre et statut

QUOREICH est un ERP financier et opérationnel destiné aux PME et groupes africains, avec interface française et devise de base XOF. Ce cahier des charges formalise la cible avant toute nouvelle implémentation.

### DOC-01 • Statut

Version 1.0 du 3 novembre 2026, document de cadrage à valider. Il ne constitue ni une certification de conformité ni une déclaration de recette intégrale. Les exigences issues des demandes sont séparées des options et des propositions nouvelles.

### DOC-02 • Finalité

Fiabiliser les opérations, réduire les doubles saisies, protéger les données par société, rendre les contrôles traçables et fournir une information financière exploitable.

### DOC-03 • Inclus

AR, AP, GL, achats, ventes, stocks, trésorerie, immobilisations, budgets, projets, dépenses, RH/paie, CRM, conformité, risques, reporting CFO, utilisateurs, alertes et migration.

### DOC-04 • Non inclus par défaut

Comptabilité réglementaire de chaque pays, interfaces bancaires universelles, déclarations fiscales automatisées, application native, mode hors ligne et nouveaux modèles IA. Leur inclusion nécessite une décision explicite.

### DOC-05 • Règle de progression

Terminer chaque module : pages, traitements métier, droits, données réelles, tests et recette. Traiter une dépendance bloquante puis revenir au module initial. Aucune nouvelle implémentation avant livraison et validation du présent cadrage.

## 02 — Utilisateurs et organisation

Chaque utilisateur agit dans une ou plusieurs sociétés autorisées. Le rôle fonctionnel décrit le métier ; la permission effective autorise une action précise.

### ORG-01 • Direction financière

Consulte les synthèses, contrôle les clôtures et compare uniquement les sociétés auxquelles elle est habilitée. La consolidation n'accorde aucun accès supplémentaire.

### ORG-02 • Opérations financières

Comptables, responsables clients/fournisseurs et trésoriers assurent saisie, vérification, rapprochement et suivi des règlements selon leurs droits.

### ORG-03 • Métiers opérationnels

Responsables achats, commerciaux, gestionnaires de stocks, chefs de projet, RH et gestionnaires de paie disposent d'un périmètre limité à leurs opérations et données nécessaires.

### ORG-04 • Contrôle et administration

Auditeurs : lecture et exports autorisés, sans modification des opérations auditées. Administrateurs : gestion des habilitations ; ce rôle ne doit pas donner silencieusement accès aux salaires ou aux validations financières.

### ORG-05 • Responsabilités à nommer

Le client désigne les référents finance, fiscalité/paie, sécurité, migration et recette. Les noms, délégations et modalités de validation restent à renseigner.

### ORG-06 • Société et exercice

Documenter société légale, devise, plan comptable, exercice, périodes, établissements et dimensions analytiques. Les règles de groupe et de multi-devise ne sont pas déduites d'un simple sélecteur de sociétés.

## 03 — Expérience utilisateur commune

L'objectif demandé est une application simple à comprendre et à utiliser, sans réduire la solidité des contrôles métier.

### UX-01 • Identité

Français, XOF par défaut, IBM Plex Sans, bleu marine institutionnel, éléments plats et tableaux lisibles dans l'esprit SAP/Sage. Formats numériques et dates cohérents ; montants alignés et précision comptable conservée.

### UX-02 • Structure

Standard cible à six rubriques : tableau de bord, transactions, données de base, rapports, contrôle, paramètres. Organisation à trois zones : filtres, travail central et détail contextuel. Les variantes RH/CRM doivent rester cohérentes.

### UX-03 • Listes

Recherche, filtres, tri déterministe et pagination adaptée au volume. Filtres actifs visibles ; même périmètre pour écran, détail et export. Les contrôles ne doivent pas changer de taille au chargement.

### UX-04 • Actions

Boutons nommés, états désactivés compréhensibles, confirmation des opérations irréversibles, retour explicite après enregistrement et absence de double soumission.

### UX-05 • États de données

Chargement identifiable, vrai état vide sans chiffres inventés, erreur explicite et reprise manuelle. Ne pas présenter un échec comme un solde nul ni afficher une réussite avant confirmation serveur.

### UX-06 • Accessibilité

Navigation clavier, nom accessible des contrôles, focus visible, nom et description des fenêtres, confinement Tab/Maj+Tab, fermeture Échap et restitution du focus. Une conformité WCAG 2.2 AA peut être retenue comme objectif de recette, pas comme acquis.

### UX-07 • Aide

Libellés métier, documentation française et recherche globale. Les explications utiles sont contextuelles ; aucune accumulation de texte promotionnel dans l'espace de travail.

## 04 — Habilitations, sécurité et audit

La séparation des sociétés et la validation des droits côté serveur sont non négociables. Masquer un bouton ne constitue pas une protection.

### SEC-01 • Isolation

Chaque donnée métier est rattachée à une société. Lectures, écritures, exports, fonctions et abonnements appliquent le même périmètre. Une société non autorisée ne doit jamais être retournée, même avec une requête modifiée.

### SEC-02 • Permissions

Définir consultation, création, modification, validation, comptabilisation, paiement, export, audit, consultation sensible et administration. Les rôles restent dans des tables protégées distinctes du profil ; aucune confiance dans le stockage navigateur.

### SEC-03 • Séparation des tâches

Matrice SoD par module : auteur/approbateur, préparateur/payeur, gestionnaire de rôle/auditeur. Les incompatibilités, exceptions, délégations et motifs doivent être validés métier ; les contrôles existants ne sont pas affaiblis.

### SEC-04 • Champs sensibles

Salaire, coordonnées bancaires, fiscalité et données personnelles protégés lors de la lecture serveur, du détail et des exports. Paie : respecter has_hr_perm ; CRM : export + view_sensitive, audit + view_sensitive selon l'action.

### SEC-05 • Traçabilité

Conserver société, acteur, action, date, référence, motif et changements pertinents. Audit des affectations de rôles et étapes CRM. Journal comptable avec chaîne d'intégrité ; une chaîne de hash ne vaut pas certification SOX.

### SEC-06 • Authentification

Connexion, déconnexion, expiration, réinitialisation du mot de passe et onboarding testés. Paramètres des inscriptions et éventuels fournisseurs de connexion à vérifier dans l'environnement, non présumés depuis le code.

### SEC-07 • Recette négative

Tester refus des accès directs, utilisateur sans rôle, compte d'une autre société, export sensible interdit et auto-approbation incompatible. Le serveur doit refuser sans modification partielle.

## 05 — Règles financières transversales

SYSCOHADA/OHADA et les standards internationaux sont des références cibles. Leur application dépend du pays, des activités et des politiques comptables validées.

### FIN-01 • Comptabilisation

Logique critique côté base : validation, calcul des totaux, balance âgée, écritures et clôtures. Chaque comptabilisation doit être atomique, équilibrée débit = crédit et traçable à sa source.

### FIN-02 • Intégrité

Une opération échouée ne crée ni écriture incomplète ni stock partiellement mis à jour. Répéter une opération déjà exécutée ne crée pas de doublon.

### FIN-03 • Correction

Écritures comptabilisées non modifiables ; correction par contre-passation documentée. Verrouillage des périodes clôturées et réouverture sous habilitation avec motif.

### FIN-04 • Paramètres

Plan de comptes, taxes, retenues, règles de paie, seuils et numérotation versionnés ou datés selon le besoin. Aucun taux légal ni numéro de compte n'est contractuellement figé sans validation locale.

### FIN-05 • Dates et arrondis

Fixer dates de document, échéance, valeur et comptabilisation, calendrier d'exercice, fuseau de référence et méthode d'arrondi. La présentation XOF ne doit pas modifier la précision des calculs.

### FIN-06 • Indicateurs sincères

Chaque KPI indique source, période, statut retenu et formule. Encaissements ≠ chiffre d'affaires ; décaissements ≠ charges ; flux net ≠ bénéfice comptable. Toute estimation doit être explicitement identifiée.

### FIN-07 • Multi-devise

Ne pas additionner des devises distinctes comme un total financier. Tant que conversion et taux ne sont pas validés, présenter des sous-totaux par devise et rendre le total mixte non interprétable comme une somme monétaire homogène.

## 06 — Comptes clients (AR)

Objectif : fiabiliser les factures clients, créances et encaissements jusqu'à leur rapprochement avec le Grand Livre.

### AR-01 • Référentiels

Clients, coordonnées nécessaires, conditions de paiement, limites de crédit et numérotation par société ; droits sur les données sensibles.

### AR-02 • Transactions

Créer et contrôler une facture et ses lignes ; totaux cohérents ; enregistrer paiements partiels/complets ; recalculer montant payé, solde et statut côté serveur.

### AR-03 • Comptabilité

Écriture client, produit et taxe conforme au paramétrage ; rapprochement des encaissements ; contrôle des périodes et prévention des doubles écritures.

### AR-04 • Recouvrement

Échéances, balance âgée, impayés, relances et règles configurables. Documenter tranches et calcul des indicateurs DSO/CEI avant recette.

### AR-05 • Reporting et contrôle

Encours, retards, exposition crédit, sources de détail et exports limités aux sociétés autorisées. Paramètres persistants et contrôles de cohérence AR/GL.

### AR-REC • Acceptation

Facture valide → créance et écriture équilibrée ; paiement partiel → solde exact ; paiement final → soldé ; facture invalide ou période close → refus sans effet ; export conforme aux droits.

### AR-06 • Avoirs et ajustements

Inclure avoirs, lettrage, ajustements et write-offs sous autorisation, motif et effets GL définis ; rappels groupés et affectation des responsables de recouvrement. Les canaux email/SMS sont demandés mais nécessitent un service configuré et une recette de distribution.

## 07 — Comptes fournisseurs (AP)

Objectif : contrôler les dettes et autoriser les paiements après les validations attendues.

### AP-01 • Référentiels

Fournisseurs, coordonnées bancaires protégées, modalités de paiement, retenues et numérotation paramétrables.

### AP-02 • Factures

Saisie des lignes, taxes et échéances ; cohérence des totaux ; rattachement au bon de commande et à la réception lorsque requis.

### AP-03 • Approbations

File de validation, seuils, étapes, délais/SLA et historique. Les niveaux exacts et délégations sont configurables et doivent être validés par société.

### AP-04 • Paiements

Paiement bloqué sans approbation requise ; contrôle des soldes ; prise en charge du partiel ; mise à jour automatique de la dette et écriture associée.

### AP-05 • Reporting

Balance âgée, planification des règlements, retards, rapprochement AP/GL et exports. Les prévisions ne doivent pas être assimilées à des paiements effectués.

### AP-REC • Acceptation

Facture approuvée → paiement autorisé ; facture non approuvée → refus serveur ; paiement répété → pas de doublon ; écarts de rapprochement visibles et traitement justifié.

## 08 — Grand Livre (GL)

Le GL est le socle de preuve comptable des opérations de tous les modules.

### GL-01 • Plan comptable

Plan hiérarchique adapté au référentiel retenu ; comptes actifs, mappings des modules et dimensions analytiques (projet/centre de coûts) cohérents par société.

### GL-02 • Journal

Saisie et comptabilisation sous permission ; séparation brouillon/comptabilisé ; équilibre strict débit/crédit ; traçabilité des sources et contrôle des dates.

### GL-03 • Imputation

Traitement réel des opérations, aperçu/dry-run lorsqu'exposé, résultat et erreurs explicites. Pas de lots simulés ni d'annonce de succès sans écriture confirmée.

### GL-04 • États

Balance générale, grand livre détaillé, soldes cumulés et justificatifs. Les états réglementaires doivent être définis et validés par l'expert-comptable local.

### GL-05 • Clôture

Contrôles préalables, verrouillage, historique et réouverture habilitée. Contre-passation avec date et motif, sans modification destructive d'une écriture comptabilisée.

### GL-06 • Audit

Journal d'audit persistant, chaîne de hash et vérification de son intégrité. Documenter accès, rétention et export ; ne pas promettre une inviolabilité absolue.

### GL-REC • Acceptation

Déséquilibre refusé ; écriture comptabilisée immuable ; contre-passation équilibrée ; période verrouillée protégée ; états rapprochables aux écritures source.

## 09 — Achats et approvisionnement

Cycle cible : demande d'achat → bon de commande → réception → facture fournisseur → paiement.

### ACH-01 • Demande et commande

Références automatiques, lignes articles/services, quantités et prix ; conversion de demande en commande avec contrôle des statuts et droits.

### ACH-02 • Approbation

Seuils et étapes de validation, SoD, SLA et escalades documentés. Ne pas figer arbitrairement trois ou quatre niveaux : le paramétrage métier fait foi.

### ACH-03 • Réception

Réceptions partielles/completes, références commande et quantités reçues ; mouvements de stock et statuts mis à jour une seule fois.

### ACH-04 • 3-Way Match

Comparer commande, réception et facture. Détecter quantités/prix/montants divergents ; bloquer la suite lorsque requis. Toute tolérance ou dérogation doit être paramétrée, autorisée et motivée.

### ACH-05 • Budget

Tracer engagements et consommations sans confondre achat engagé et dépense réelle. Confirmer à quel événement les montants sont engagés, consommés ou libérés.

### ACH-REC • Acceptation

Parcours complet rapproché ; réception partielle contrôlée ; dépassement/tolérance traité ; paiement interdit en cas de blocage ; retry sans duplications stock ou comptabilité.

## 10 — Ventes et stocks

Les ventes sont reliées au CRM, aux livraisons, aux créances et aux coûts réels des stocks.

### VEN-01 • Cycle commercial

Devis → commande → livraison → facture AR. Conversion idempotente ; client obligatoire ; statuts et documents reliés ; prévention des doubles factures.

### VEN-02 • Livraison et crédit

Livraisons partielles, quantités restantes, contrôle de crédit client et période verrouillée. La sortie physique ne doit pas être comptée deux fois à la commande et à la livraison.

### VEN-03 • Marge réelle

Remplacer l'hypothèse actuelle de coût fixe à 60 %. Calculer une marge sur ventes et coûts effectivement enregistrés ; définir taxes, remises et retours. Si le coût manque, afficher une donnée indisponible, non une marge supposée.

### STK-01 • Référentiels et flux

Articles, entrepôts et emplacements ; entrées, sorties, transferts et inventaires liés à une source. Validation serveur des quantités et des droits.

### STK-02 • Valorisation

Méthode CMP et couches de valorisation lorsque retenues ; coût de sortie traçable. Politique de stock négatif, arrondis, retours et recalculs à valider, sans hypothèse silencieuse.

### STK-03 • Inventaire et clôture

Comptage, écarts justifiés, comptabilisation et clôture de période idempotente, historique et contrôles des opérations postérieures.

### VEN/STK-REC • Acceptation

Livraison → stock et créance cohérents ; transfert conserve la quantité totale ; inventaire justifié ; marge vérifiable sur coûts réels ; accès intersociétés refusé.

## 11 — Trésorerie et rapprochement

Objectif : suivre les comptes bancaires réels, les flux et la disponibilité de trésorerie.

### TRE-01 • Comptes et mouvements

Comptes bancaires, soldes, transactions, relevés et lignes de relevé par société. Informations bancaires sensibles soumises à permission.

### TRE-02 • Rapprochement

Vue à trois zones : opérations internes, suggestions de correspondance et relevé. Validation des correspondances et conservation des écarts et justificatifs.

### TRE-03 • Prévision

Prévision glissante de 13 semaines, hypothèses et scénarios identifiés, distinction données réalisées/prévues et suivi des résultats.

### TRE-04 • Historique réel

Supprimer comptes et flux mensuels fictifs du reporting. Reconstituer les soldes historiques depuis mouvements et point de départ fiable, ou déclarer l'historique indisponible ; ne pas répéter le solde courant comme historique.

### TRE-05 • Clôture

Contrôles des rapprochements, cohérence bancaire/GL, historique de clôture, habilitations et idempotence. Export d'un rapport de clôture utile à l'audit.

### TRE-06 • Reporting

Position bancaire, flux, encaissements/décaissements et export fonctionnel issus des mêmes données filtrées que l'écran.

### TRE-REC • Acceptation

Solde justifié par flux ; rapprochement conservé après rechargement ; période close protégée ; export sans données inventées ; absence d'historique explicitement affichée.

### TRE-07 • Horizons demandés

Prévisions 30/60/90 jours et plage personnalisée en complément des 13 semaines ; comportement historique clients, saisonnalité, scénarios optimiste/pessimiste et variables macroéconomiques. Définir sources, méthode et incertitude avant d’affirmer une prédiction fiable.

## 12 — Immobilisations, budgets et projets

Ces domaines doivent conserver leurs liens analytiques et comptables avec le GL.

### IMM-01 • Registre

Catégories, acquisition, date de mise en service, valeur, durée et comptes d'imputation ; règles comptables validées par société.

### IMM-02 • Amortissement et sortie

Calcul mensuel, comptabilisation idempotente et historique ; cession/mise au rebut avec prix éventuel, valeur nette et écritures associées. Aucun taux fiscal inventé.

### BUD-01 • Budgets

Budget par exercice, période, compte/dimension et société ; lignes, scénarios, écarts et comparaison réalisé/budget. Versions et approbations selon le besoin validé.

### BUD-02 • Engagements

Lien aux commandes et dépenses ; distinguer engagé, réalisé et disponible. Empêcher les doubles consommations entre achat, facture et paiement.

### PRO-01 • Projets

Référentiel, responsable, statut, dates, budget et coûts associés ; suivi de rentabilité et avancement fondé sur données enregistrées.

### PRO-02 • Contrôle

Droits projets, affectations de rôles auditées, coûts et dimensions analytiques rapprochés au GL ; export selon permissions.

### IMM/BUD/PRO-REC • Acceptation

Relance d'amortissement sans doublon ; sortie justifiée ; dépense reliée au projet et au compte ; chiffres budgétaires explicables par leur source.

## 13 — Dépenses, RH et paie

La paie et les données des employés nécessitent une protection supérieure à la simple visibilité des menus.

### DEP-01 • Notes de frais

Rapport et lignes de dépenses, rattachement employé/projet, justificatifs lorsque pris en charge, contrôles, approbation et règlement ; règles locales à valider.

### RH-01 • Employés

Liste recherchable, filtrable et paginée ; création/édition/consultation selon RBAC ; protection des champs sensibles côté serveur et actions autorisées uniquement.

### PAY-01 • Cycles

Liste des cycles avec recherche, filtres et tri ; détails, génération des lignes, validation et comptabilisation ; confirmations, chargements et erreurs explicites.

### PAY-02 • Calcul

Brut, retenues, taxes et net produits selon règles validées. Ne pas présenter le moteur actuel comme conforme à tous les pays ; pays, conventions, barèmes et dates d'effet sont obligatoires avant recette réglementaire.

### PAY-03 • Exports et audit

CSV/PDF d'un cycle selon has_hr_perm ; masquage effectif si consultation sensible interdite. Audit du cycle filtrable et paginé ; historique hr_role_audit par société/utilisateur.

### RH-02 • Administration

Affectation/retrait des rôles par fonction sécurisée, SoD côté serveur et motif audité. Pas de privilège dérivé des métadonnées modifiables par l'utilisateur.

### RH/PAY-REC • Acceptation

Net justifiable ; génération répétée sûre ; acteur non autorisé refusé ; export ne révèle aucun salaire interdit ; écriture paie équilibrée et liée au cycle.

### RH-EXC • Exclusion ferme

Fonctionnalités et écrans CNSS et apparentés exclus à la demande de l’utilisateur ; ne pas les réintroduire sans nouvelle demande explicite. Les autres règles de paie nécessitent néanmoins un cadrage local.

## 14 — CRM, conformité et risques

Le CRM assure la continuité commerciale ; conformité et risques documentent les contrôles sans prétendre à une certification automatique.

### CRM-01 • Contacts

Recherche, filtres, pagination, champs clés et droits crm-roles ; import CSV avec validation et récapitulatif des erreurs avant sauvegarde.

### CRM-02 • Opportunités

Pipeline par étapes, détail, timeline, activités, responsables et assignations ; drag-and-drop facultatif. Conversion en devis liée au client et idempotente.

### CRM-03 • Actions groupées

Changer d'étape, assigner, archiver avec les mêmes droits et SoD que les actions unitaires. Définir le comportement atomique ou le résultat détaillé par ligne avant recette.

### CRM-04 • Rappels et exports

Activités planifiées avec états à faire/en retard/terminé ; exports Contacts/Opportunités selon export + view_sensitive ; export d'audit étapes/assignations selon audit + view_sensitive.

### CON-01 • Conformité

Référentiels de contrôle, tests, résultats, responsables et historiques ; preuves et statut. Référentiels exacts, fréquence et conservation à valider.

### RIS-01 • Risques

Registre, vraisemblance, impact, score, propriétaire, mitigation et revues. Cartographie et contrôle des affectations de rôles ; seuils documentés dans les paramètres métier.

### CRM/CON/RIS-REC • Acceptation

Import invalide non enregistré ; action groupée interdite refusée ; rappel reflète la date et l'état réel ; audit complet ; aucune exposition sensible dans les exports.

## 15 — Reporting CFO et notifications

Les chiffres du cockpit doivent être explicables et les notifications doivent suivre les préférences réellement sauvegardées.

### CFO-01 • Consolidation

Sélecteur des sociétés autorisées, KPI par société, détail des sources et total homogène par devise. Les fonctions serveur intersectent toujours la demande avec les sociétés accessibles.

### CFO-02 • Tendances

Périodes 3/6/12 mois pour Total Revenue, Total Expenses, Net Profit et Cash Balance. Les libellés doivent correspondre à des formules comptables validées ; le calcul actuel basé sur paiements ne suffit pas à certifier revenu/charges/bénéfice.

### CFO-03 • Export principal

CSV contenant les KPI et les quatre séries, même sélection et période que les graphiques. Attendre les deux jeux de données ; refuser un export incomplet ou obsolète après changement du périmètre.

### CFO-04 • Détail

Ouverture via boutons d'en-tête au clavier, décomposition par société, sources de données, chargement/erreur explicites et focus restitué. Les KPI de situation ne deviennent pas des KPI de période par simple changement du filtre de tendances.

### ALT-01 • Alertes

Cloche et page dédiée ; lire, marquer toutes lues, résoudre et résoudre en masse selon droits. État persistant et mise à jour temps réel cohérente.

### ALT-02 • Préférences

Préférences sauvegardées en base et appliquées aux requêtes serveur. Pagination et tri côté serveur sur /alerts ; tests des actions groupées et isolement des sociétés.

### CFO/ALT-REC • Acceptation

KPI, détail et CSV même périmètre ; 3/6/12 lignes mensuelles attendues ; erreur réessayable ; alerte lue/résolue relue avec le même état après rechargement.

### RPT-01 • Centre de rapports

États bilan, compte de résultat, balance générale/analytique, grand livre, AR/AP Aging et cash-flow ; exercice/période, N/N-1, hiérarchie repliable et détail des écritures. Définir validation comptable et formats CSV/PDF/Excel selon rapport.

### RPT-02 • Reporting avancé demandé

Choix des sources et colonnes, filtres, regroupements, modèles enregistrés, permissions et distribution planifiée sécurisée. Consolidation légale avec éliminations intercompany à spécifier séparément du simple cumul de KPI ; aucun traitement d’élimination n’est certifié ici.

## 16 — Migration depuis un autre système

La migration doit être préparée, contrôlée et rapprochée avant bascule. La présence d'un assistant CSV ne suffit pas à valider l'ensemble du processus.

### MIG-01 • Inventaire

Identifier système source, propriétaire, formats, volumes, qualité, sociétés, exercices, historique à reprendre et données sensibles. Aucun nom de logiciel source n'est présumé.

### MIG-02 • Correspondance

Dictionnaire source/cible, identifiants externes, encodage, dates, décimales, taxes, comptes, devises et liens. Reprendre les référentiels avant les transactions dépendantes.

### MIG-03 • Validation avant écriture

Champs obligatoires, formats, références existantes, sociétés autorisées, totaux et doublons. Afficher ligne, champ, valeur et motif ; permettre correction puis nouvelle validation sans écriture silencieuse.

### MIG-04 • Doublons et reprise

Choisir rejet, rapprochement ou mise à jour contrôlée selon objet. Idempotence par lot/référence source ; rapport des lignes acceptées/refusées ; politique transactionnelle explicite.

### MIG-05 • Recette de migration

Essai sur un environnement dédié ; rapprochements quantités, soldes clients/fournisseurs, balances GL, stocks et valeurs, actifs et paie si concernés. Écart inexpliqué = bascule non validée.

### MIG-06 • Bascule

Sauvegarde vérifiée, gel de saisie convenu, dernière extraction, import, contrôle, approbation et reprise d'activité. Retour arrière et opérations intervenues après bascule documentés avant lancement.

### MIG-07 • Formats et historique

CSV est le périmètre existant. Import Excel direct et historique durable des lots sont à décider ; ne pas annoncer XLSX comme pris en charge sans lecteur et tests effectifs.

### MIG-REC • Acceptation

Aucune ligne invalide écrite ; droits appliqués côté serveur ; doublon traité selon règle validée ; soldes rapprochés ; rapport d'import exploitable sans exposition intersociétés.

## 17 — Architecture et données

Cette section technique fixe les contraintes de pérennité sans imposer de nouvelles fonctionnalités non demandées.

### TEC-01 • Application

React 18, TypeScript, Vite, composants de design existants et requêtes mises en cache. Backend Lovable Cloud : PostgreSQL, authentification, stockage et fonctions serveur ; aucun serveur persistant ajouté au client.

### TEC-02 • Modèle

Domaines : sociétés/profils/rôles ; clients/fournisseurs ; factures/paiements ; écritures/lignes ; achats/réceptions ; ventes/livraisons ; articles/mouvements ; paie ; CRM ; audit/alertes. Chaque relation métier doit préserver le rattachement à la société.

### TEC-03 • Accès

Politiques de lignes activées, droits d'accès explicites sur toute table publique et fonctions sécurisées. Le contexte central de société s'applique aux modules ; consolidation uniquement par accès autorisés.

### TEC-04 • Logique serveur

Validations, autorisations, SoD, transitions critiques, écritures et idempotence dans les traitements serveur. Le client affiche et orchestre sans devenir l'autorité comptable.

### TEC-05 • Temps réel

Invalider les requêtes pertinentes à la confirmation des changements ; subscriptions limitées au périmètre autorisé. Ne pas substituer données de démonstration ou sondage infini à une erreur de synchronisation.

### TEC-06 • Contrats

Documenter champs, types, dates, valeurs nulles, statuts, clés uniques, erreurs et pagination. Les colonnes sources dans les fonctions de consolidation doivent être qualifiées pour éviter les ambiguïtés.

### TEC-07 • Secrets et versions

Clés privées hors du code et des exports, migrations versionnées, changements compatibles et tests de non-régression. Aucun secret ni identifiant interne d'infrastructure dans les livrables utilisateur.

## 18 — IA, ML/DL et intégrations optionnelles

Les analyses IA déjà présentes ne sont pas une garantie de prédiction fiable. Les extensions suivantes sont des candidats à cadrer, non des livraisons approuvées.

### IA-01 • Prévision de trésorerie

Comparer référence naïve, modèle statistique et modèle d'apprentissage supervisé selon quantité/qualité d'historique. Mesurer l'erreur hors échantillon et intervalle d'incertitude ; ne jamais inventer un historique.

### IA-02 • Anomalies comptables

Règles déterministes puis modèle de détection d'anomalies si données suffisantes. Mesurer précision, rappel et faux positifs ; l'alerte ne prouve pas une fraude.

### IA-03 • Candidats ML

Catégorisation des dépenses : classification supervisée ; risque client : modèle calibré et explicable ; rapprochement : scoring puis validation humaine. Algorithmes exacts et objectifs à choisir après étude des données.

### IA-04 • Candidats DL/IA générative

OCR/extraction de factures et assistant comptable documentaire. Contrôle des champs, sources citées, protection des données et validation humaine ; aucune comptabilisation automatique d'une réponse non contrôlée.

### IA-05 • Gouvernance

Consentement/périmètre légal, minimisation, jeux d'essai séparés, coûts/quotas, suivi de dérive, version de modèle, journal et mode dégradé. Aucun entraînement externe avec données sensibles sans autorisation.

### INT-01 • Connexions externes

Banques, paiements, email, systèmes sources et authentification externe doivent être décrits individuellement : fournisseur, échange, fréquence, sécurité, disponibilité et responsabilités. Une mention d'écran n'est pas une intégration disponible.

### IA/INT-REC • Décision

Valider cas d'usage et métrique métier avant achat/intégration. Les choix de modèles, budgets, seuils et partenaires restent ouverts ; fonctionnement hors connexion et application installable relèvent aussi d'une décision distincte.

### IA-06 • Capacités déjà demandées

Prévision de cash et anomalies GL : détail des lignes débit/crédit, accès à l’écriture, planification automatique, résultats sauvegardés et historique. Filtres serveur par dates, pagination, relance avec mêmes paramètres après confirmation et progression visible.

## 19 — Exigences non fonctionnelles et exploitation

Les objectifs chiffrés ci-dessous doivent être contractualisés avec les volumes et l'hébergement. Aucun SLA actuel n'est déduit du code.

### NFR-01 • Performance

Définir utilisateurs simultanés, lignes par table, taille des imports, durée d'historique et temps de réponse cible. Mesurer aux volumes convenus ; pagination serveur et traitements lourds contrôlés.

### NFR-02 • Disponibilité

Définir disponibilité, plage de maintenance, délai d'intervention et responsabilités. L'existence de Lovable Cloud ne constitue pas un engagement de disponibilité propre à ce projet.

### NFR-03 • Continuité

Fixer RPO/RTO, fréquence/rétention des sauvegardes et procédure de restauration ; réaliser un essai et documenter le résultat avant mise en service critique.

### NFR-04 • Confidentialité

Inventaire des données personnelles, localisation et transferts, base légale, accès, conservation, suppression et obligations nationales à valider. Les pièces, exports et audits ont des durées distinctes.

### NFR-05 • Observabilité

Erreurs de calcul, accès refusés, traitements échoués et délais surveillés sans enregistrer de secrets. Alertes d'exploitation et procédure de reprise avec acteur responsable.

### NFR-06 • Compatibilité

Navigateurs et tailles d'écran à définir et tester. Priorité aux tableaux utilisables sans débordement de page et aux actions clavier ; une version native n'est pas incluse.

### NFR-07 • Maintenance

Documentation métier/technique, mises à jour, versionnement, jeux de recette et sécurité des dépendances. Éviter les textes d'aide annonçant un comportement non implémenté.

### SaaS-01 • Administration commerciale

Activation de modules par société selon droits, licence et dépendances, audit des changements. Abonnements, facturation SaaS et suivi de service demandés au cadrage : prix, plans, prestataire de paiement et règles d’accès à définir ; aucune tarification inventée.

## 20 — Plan de recette et preuves attendues

Une livraison est acceptée par preuves, pas par présence de pages ou par un message historique de fin de lot.

### REC-01 • Niveaux

Tests de règles financières, intégration des traitements, parcours navigateur connectés, accès négatifs, exports, erreurs/vides, clavier et charge aux volumes retenus.

### REC-02 • Données

Cas d'essai contrôlés et isolés ; données réelles autorisées pour contrôles en lecture. Les fixtures de tests ne sont jamais injectées dans les écrans métier en production.

### REC-03 • Parcours prioritaires

AR facture → paiement → GL ; AP facture → approbation → paiement ; achat → réception → rapprochement ; vente → livraison → facture → coût ; clôture ; paie ; import ; CFO et alertes.

### REC-04 • Matrice minimale

Pour chaque action : succès, absence de droit, autre société, entrée invalide, répétition, interruption et lecture après rechargement. Vérifier refus sans effets partiels et retour explicite.

### REC-05 • Exports et accessibilité

Contrôler contenu et montants des fichiers, sélection/période, protection sensible, téléchargement réel ; focus initial, confinement, Échap et restitution du focus dans les détails.

### REC-06 • Dossier de preuve

Exigence, test, environnement, compte/périmètre sans secret, résultat, date, anomalie et décision de recette. Les contrôles automatiques réussis ne remplacent pas les validations comptables locales.

### REC-07 • Critère proposé de mise en service

Aucune anomalie critique d'isolation, de droits, de perte de données ou d'équilibre comptable ; anomalies restantes explicitement acceptées et planifiées. Classification et signataires à valider.

## 21 — État actuel, écarts et séquencement

État arrêté au 3 novembre 2026. La cible décrite dans les chapitres précédents est plus large que le périmètre effectivement vérifié.

### ETAT-01 • Présent dans les sources

Pages et traitements pour les modules recensés, rôles spécialisés, audit, import CSV, alertes, cockpit, paie et CRM. Cette présence ne prouve pas une recette globale ni une conformité réglementaire.

### ETAT-02 • CFO vérifié pendant ce lot

Erreur serveur tenant_id ambigu corrigée, sources bancaire/risques alignées, reprise d'erreur explicite. 16 tests ciblés réussis ; navigateur connecté : KPI, CSV 3/6/12, ARIA/clavier/focus et rejet d'un identifiant de société inaccessible. Pas de certification de consolidation groupe ou de toutes les formules.

### ECART-01 • Données et indicateurs

Reporting Trésorerie avec données fictives ; marge Ventes basée sur un coût supposé ; tendances CFO assimilant flux de paiement à revenu/charges/bénéfice et répétant le solde courant. Corrections et recette financière nécessaires.

### ECART-02 • Migration et navigation

Validation complète des imports et contrôles serveur à approfondir ; Excel annoncé sans lecture directe vérifiée ; historique durable non établi. Paramètres Dépenses présents en route mais navigation à harmoniser.

### LOT-01 • Après validation

Priorité 1 : données sincères, formules, droits et invariants ; reprendre AR → AP → GL → achats → ventes, sans rouvrir automatiquement les fonctions déjà validées.

### LOT-02 • Ensuite

Trésorerie réelle, marge/coûts et consolidation ; terminer les modules dépendants ; fiabiliser migration et recettes transversales. Extensions IA/Excel/offline uniquement après décision.

### LOT-03 • Livrables

Par module : pages, référentiels, traitements serveur, droits, tests, documentation, rapport de recette et anomalies. Aucun délai, budget ou capacité d'équipe n'est inventé ; planning à établir après validation du périmètre.

## 22 — Décisions ouvertes et approbation

Ces décisions ne bloquent pas la rédaction ; elles doivent être tranchées avant l'implémentation ou la contractualisation du domaine concerné.

### DEC-01 • Réglementation

Pays et sociétés cibles, référentiel applicable, fiscalité, règles de paie, états réglementaires et expert chargé de leur validation.

### DEC-02 • Politiques financières

Plan comptable/mappings, taxes, arrondis, statut de reconnaissance du revenu, méthode des coûts, tolérances achats, crédit, stock négatif, clôture et multi-devise.

### DEC-03 • Habilitations

Rôles par société, matrice SoD, délégations, seuils d'approbation et responsables de l'audit. Rétention des données et preuves.

### DEC-04 • Migration

Système source, objets/historique, volumes, CSV ou XLSX, traitement des doublons, historique durable des lots, gel et retour arrière.

### DEC-05 • Service et options

SLA/RPO/RTO, charge, intégrations, objectifs d'accessibilité, modèles IA, coût/quotas, application installable et hors connexion.

### VAL-01 • Validation

Client/référent métier : nom, date, accord ou réserves. Référent comptable/paie : idem. Référent sécurité/technique : idem. Responsable recette : idem. Aucune approbation n'est présumée.

### VAL-02 • Gestion des changements

Chaque évolution précise exigence affectée, impact sur règles/données/droits, tests, migration éventuelle et décision. Versionner le cahier des charges ; ne pas modifier rétroactivement le périmètre accepté.

### REF • Sources

Demandes historiques du projet, mémoires métier, inventaire des routes/modules, README et guide utilisateur, backlog consolidé du 2 novembre, roadmap et contrôles CFO exécutés les 2–3 novembre 2026. Les documents descriptifs anciens sont confrontés aux écarts observés.