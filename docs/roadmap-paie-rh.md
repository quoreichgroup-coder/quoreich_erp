# Suite du lot Paie/RH

État au 15 novembre 2026. La V80 est appliquée sur `qerp_reel` et Supabase; les 201 tests Java passent. La réception métier reste en attente des barèmes pays validés et de la recette UI des documents.

## Conditions d'entrée

- Même version V80 sur PostgreSQL on-premise et Supabase; exécution réussie des tests d'intégration Java/PostgreSQL (190/190).
- Barèmes et comptes confirmés par entité et pays, avec référence juridique, date d'effet et cas de paie témoin approuvé.
- Recette des exports et impressions réels sous des rôles distincts, avec validation du masquage et des périodes/devises.

## État de réalisation — 15 novembre 2026

- V81 : accès API et sécurité des champs RH sensibles; parité d'adaptateur on-premise/Supabase.
- V82 : mouvements RH effectifs-datés, séparation soumission/approbation, journal immuable et calcul du dossier à la date demandée.
- V83 : types et motifs de mouvement gérés par société sous Paramètres, droits reliés au catalogue central et validation obligatoire en PostgreSQL.
- Vérifications de cette passe : 83 migrations exécutées sur PostgreSQL 18.6 éphémère; `HrApiIT` 8/8; TypeScript; 24 tests Vitest ciblés; lint ciblé sans erreur; migrations jumelles V16–V83 identiques.
- État : lot RH/Paie toujours en cours. Le lot suivant est la définition détaillée des composantes et variables de paie; paiement, bulletins, absences et réception intégrée restent ouverts. Aucun changement V81–V83 n'a été appliqué à `qerp_reel` ou Supabase.

## Ordre des lots

| Rang | Lot | État / dépendance | Résultat attendu |
|---|---|---|---|
| 0 | V80 — calcul et cycle | V80 déployée et suite Java verte; réception métier/UI à faire | Faire confirmer les règles pays, valider les paies témoins, les droits, l'impression et les exports avant réception. |
| 1 | Paiement effectif des salaires | À spécifier après réception V80 | Ordres par salarié et devise, fichiers bancaires issus d'un profil configuré, retours/rejets, rapprochement du compte de paie. |
| 2 | Bulletins individuels | Dépend d'une paie validée et de lignes de calcul détaillées | Bulletin par personne/période, imprimable et rééditable sous permission; montant masqué ou accès individuel selon les droits centralisés. |
| 3 | Mouvements du personnel | V82/V83 implémentés; tests de chevauchement, entrée/sortie/réintégration et recette UI restent à compléter | Historique effectif-daté des entrées, changements de poste/salaire/département, suspensions et sorties, avec auteur et motif. |
| 4 | Temps, absences et variables | Dépend des règles pays et des référentiels RH | Saisie/approbation des heures, congés, heures supplémentaires et primes; éléments approuvés transmis au calcul de paie et photographiés. |
| 5 | Contrôle et clôture RH/finance | Dépend des lots de paiement et variables | Contrôles budgétaires paie/frais, rapports consolidés et rapprochement des soldes sans doubles comptes. |

## Lot 1 — Paiement effectif

**Réalisé par V154 (26 nov. 2026)** — voir `docs/audit-erp/32-audit-rh-paie.md` § E septies. Reste à faire : import
du fichier de retour bancaire, formats XML si une banque l'exige, validation du premier fichier avec chaque banque.

### Parcours attendu

1. Créer un lot à partir d'un cycle comptabilisé et de son net à payer; contrôler la devise, les bénéficiaires, les coordonnées requises et la dette ouverte avant toute émission.
2. Présenter une revue par salarié et total par devise; soumettre à l'approbation avec motif, droit de séparation préparateur/approbateur et journal des changements.
3. Produire le fichier à partir d'un profil bancaire de la société. La banque, le pays, la version du format, les champs obligatoires, encodage, séparateur, format de date et conventions de montant sont des paramètres administrés. Aucun format bancaire n'est présumé.
4. Conserver le fichier et son empreinte, enregistrer la remise à la banque, puis importer ou saisir les retours. Chaque paiement doit distinguer préparé, soumis, accepté, rejeté, payé et rapproché; le retour bancaire réel décide de l'état, jamais la seule génération du fichier.
5. Représenter les rejets sans perdre l'historique; permettre une correction puis une nouvelle émission contrôlée. Empêcher le paiement en double par une clé d'idempotence et un contrôle de montant/devise/bénéficiaire.
6. Comptabiliser le règlement et rapprocher la dette salariale et la banque à partir des paiements confirmés, en utilisant le rôle de compte paramétré pour le référentiel comptable de la société (par exemple le compte de rémunérations dues prévu par SYSCOHADA). La règle de ventilation entre dette nette, retenues et charges est à valider avec le plan comptable de la société avant implémentation.

### Critères de réception

- Scénarios positif, rejet partiel, rejet total, correction, doublon, devise mixte et rapprochement incomplet testés sur PostgreSQL.
- Modèles de fichier bancaires versionnés et validés par exemples de la banque concernée; prévisualisation et rapport de validation avant téléchargement.
- Rôles de préparation, approbation, émission, retour bancaire, rapprochement et consultation définis dans le catalogue central d'Administration/Paramètres et vérifiés en RLS/API.
- Exports Excel/CSV/PDF filtrés sur le lot sélectionné; PDF de contrôle paginé, Excel filtrable avec nombres, CSV UTF-8; données bancaires masquées selon le droit sensible.

## Lot 2 — Bulletins

Le schéma actuel conserve des totaux par ligne (brut, retenues, impôt, net, charges patronales), pas nécessairement chaque composante de rémunération. Avant un bulletin détaillé, ajouter des éléments de paie persistés et photographiés au calcul: code/libellé, base, taux, montant, catégorie et ordre d'affichage. Les éléments et leur traitement doivent venir des règles confirmées du pays et de la société.

Le bulletin doit identifier l'employeur et le salarié, le matricule, la période, la date et la devise; détailler gains et retenues, totaux, net à payer et références utilisées; s'imprimer sur une page lisible et s'exporter individuellement. Toute réédition garde l'historique, l'accès nominatif est vérifié côté serveur et les exports en lot respectent `view_sensitive` et le droit central `export`.

## Présentation des documents

- **PDF / impression** : société, titre, période et filtres visibles, devise explicite, date de génération, numéros de page, répétition des en-têtes et lignes non coupées. La mise en page doit être contrôlée visuellement en A4 avant réception.
- **Excel** : en-têtes lisibles, ligne d'en-tête figée, filtres, largeur adaptée et nombres stockés comme nombres avec séparateur de milliers; aucune devise ne doit être déduite implicitement.
- **CSV** : UTF-8 avec BOM, séparateur français `;`, virgule décimale, dates ISO et colonnes suivant exactement le filtre affiché.
- Un export échoue visiblement si le chargement a échoué ou si un droit manque. Aucun échantillon, total simulé ou valeur de démonstration dans les rapports métier.

La V80 ajoute pagination et formats numériques lisibles aux PDF/Excel génériques. La recette navigateur et l'ouverture des fichiers dans Excel/lecteur PDF restent à effectuer.

## Références fonctionnelles consultées

- [Sage 300 — options d'impression des rapports](https://help.sage300.com/en-us/2026/web/Content/Reports/ReportPrintingOptions.htm)
- [Sage 300 Payroll — historique des transactions salarié](https://help.sage300.com/en-us/2024/classic/Subsystems/UP/Content/Reports/Employee/UsingtheTransactionHistoryReport.htm)
- [Sage 300 People — analyse et rapports de paie](https://za-kb.sage.com/portal/app/portlets/results/botviewsolution.jsp?hypermediatext=null&solutionid=200610114010027)
- [Sage 300 People — traitement et rapport de paiement](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?page=1&position=1&q=acb&solutionid=200411085450331)
- [Sage 300 People — impression des bulletins](https://za-kb.sage.com/portal/app/portlets/results/viewsolution.jsp?solutionid=200410151812476&view=print)
- [SAP — reporting de paie](https://help.sap.com/docs/HR_RENEWAL/efa1f379fd8b4ff6b825f5105cbc27e5/cc92e0535e56424de10000000a174cb4.html?version=1.4.latest)
- [Sage X3 — fonctions financières](https://www.sage.com/en-us/sage-business-cloud/sage-x3/product-capabilities/financial/)

Ces références guident la séparation entre registre, analyse, paiement et bulletin; elles ne déterminent pas les règles fiscales ni les formats bancaires de QERP.

## Mise à jour d'avancement V84

- V84 ajoute des rubriques de rémunération configurables par société (gains, retenues, charges, méthodes, plafonds, dates d'effet, compte, ordre et impression) dans Paramètres RH, avec le droit central `hr.manage_payroll_components`.
- Contrôles de cette passe : 84 migrations appliquées sur PostgreSQL 18.6 jetable; `HrApiIT` 9/9; TypeScript; migrations jumelles 69/69.
- Limite à traiter avant recette : les rubriques ne sont pas encore affectées aux salariés ni intégrées aux lignes de calcul. Les variables, validations des variables, détails des bulletins, paiement, absences et parcours intégrés restent ouverts. Aucun déploiement n'a été fait sur `qerp_reel` ou Supabase.

## Mise à jour d'avancement V87

- V85–V87 ajoutent les affectations datées, les variables à référence unique avec approbation distincte, le calcul par rubrique et les lignes détaillées figées avec le cycle.
- `HrApiIT` couvre l'affectation tenant, le montant du gain dans le brut, la photographie de la ligne, le blocage d'une variable en attente et le résultat après approbation.
- Le paramétrage des assiettes fiscales/sociales est explicite par rubrique; les valeurs juridiques restent à renseigner par l'entreprise.
- V88 conserve l'écart entre valeur de rubrique et montant de remplacement lors de l'édition d'une affectation.
- Restent à terminer avant recette : contrôles exhaustifs des règles et arrondis, rapprochement comptable par rubrique, mise en page complète du bulletin avec identité/période, temps et absences, paiements réels et parcours intégrés on-premise/Supabase. Les migrations V81–V87 ne sont pas déployées sur `qerp_reel` ni Supabase.

## V89 — Précontrôle avant approbation

- Précontrôles horodatés et immuables, avec erreurs persistées, contrôles de totaux, photographie, variables en attente et comptes comptables actifs.
- L’approbation exige un contrôle sans anomalie effectué après la dernière génération; le préparateur ne peut pas approuver son propre cycle.
- Le contrôle d’équilibre affiche tous les cycles chargés, sans limite arbitraire de douze.
- Validation : migration Flyway PostgreSQL éphémère, HrApiIT 10/10, TypeScript, build, migrations jumelles et vérification API.
- Le lot Paie/RH reste incomplet : paiement bancaire/retours, temps/absences, corrections/contrepassations, intégration comptable des comptes par rubrique et parcours complet Supabase/on-premise restent à réaliser et tester avant recette. Aucune migration V81+ n’est appliquée aux bases métier.

## Vérification du diagnostic et progression du 16 novembre 2026

- La trace Claude Code du parcours local utilise `VITE_QERP_API_URL` vers l’API Java; l’environnement de développement actuel ne définit pas cette variable dans `.env`, `.env.cloud` ni les variables Windows. Le front courant appelle donc Supabase. Les traces ne montrent pas que Claude ait exécuté l’écran des rubriques; l’absence de cette erreur ne prouve donc pas que la RPC fonctionnait.
- La base locale `qerp_reel`, interrogée en lecture seule sur `127.0.0.1:54433`, est en V80. Les RPC `list_hr_payroll_components`, `list_hr_movement_references` et `list_hr_employee_number_settings` n’y existent pas. Le port `55433` ne répond pas. Les fonctions RH V81+ ne sont donc pas disponibles sur l’on-premise actuellement vérifié.
- L’erreur `PGRST202` vient de la Data API Supabase et indique que la RPC n’est pas trouvée dans son schéma exposé; elle peut manquer en base ou dans son cache. La nouvelle formulation demande de vérifier la migration ciblée et les migrations dépendantes, puis de rafraîchir le schéma si nécessaire. L’état de migration Supabase n’a pas pu être lu avec les accès disponibles.
- Aucun changement n’a été appliqué à `qerp_reel` ou Supabase. Le code V81–V95 reste à synchroniser sur les bases métier après recette et accès authentifiés.
- La couverture de V82/V95 inclut maintenant le rejet d’un mouvement avec motif, la non-application au dossier effectif, le refus d’une décision en double et l’interdiction d’un motif désactivé. V97 ferme un défaut SQL où un taux d’impôt `NULL` pouvait être confirmé comme valide. L’API on-premise caste aussi explicitement la date d’effet du barème au type PostgreSQL `date`.
- Validation locale : `HrApiIT` 15/15 sur PostgreSQL Testcontainers 18.6 jusqu’à V97; `OpenApiContractIT` 3/3; 81 paires de migrations V16–V97 identiques; TypeScript. La suite Vitest complète passe maintenant 583/583.
- L’écran Rubriques RH ne présente plus un catalogue vide quand le chargement échoue sur PGRST202; le message d’erreur et le bouton de reprise restent visibles. Un test de régression vérifie cet état.
- Le correctif de pagination PDF remplace `doc.internal.getNumberOfPages()` par l’API publique `doc.getNumberOfPages()` dans les exports générique et récapitulatif paie; le mock du test PDF suit désormais l’API jsPDF.

## V98 — Comptabilisation par rubrique de paie

- Les gains, retenues et charges employeur utilisent maintenant le compte configuré et photographié sur chaque rubrique; les cotisations légales et l'impôt conservent leurs rôles comptables de société.
- Le précontrôle vérifie les codes de compte tenant-scoped, actifs et imputables, et bloque une rubrique dont le compte a été désactivé après le calcul. Les cycles sans détail de rubriques gardent la comptabilisation agrégée historique.
- Références : [SAP sur les comptes symboliques et types de débit/crédit](https://help.sap.com/docs/ERP_HCM_SPV/e09772d353c6445c8cef2d8cbff5c0b0/9018dd5321e8424de10000000a174cb4.html?locale=en-US); [Sage 300 sur le compte général des gains et retenues](https://help.sage300.com/en-us/2025/classic/Content/Payroll_Help/Setup/AddinganEarningorDeductionCode.htm).
- Validation : `EtatsParRubriquesIT` 8/8 sous PostgreSQL 18.6, y compris écritures détaillées équilibrées, compte inactif bloqué au précontrôle, `db:check-twins` 82 paires; suite front 583/583.

## Revue du bulletin individuel — 16 novembre 2026

- Le bulletin et ses exports CSV, Excel et PDF respectent désormais le champ `printable` photographié dans les lignes du cycle. Les totaux enregistrés restent inchangés : masquer une rubrique à l'impression ne modifie pas le calcul de paie.
- CSV et Excel identifient le salarié (nom et matricule transmis par le cycle), ainsi que son identifiant, l'employeur, la période et la devise.
- Les téléchargements attendent le chargement de l'employeur et des lignes et restent bloqués en cas d'erreur, d'identité absente ou de devise manquante. Un dialogue fermé ne demande plus les rubriques de tout le cycle.
- Vérification : trois tests de régression du bulletin, cinq tests des exports et permissions, TypeScript et lint ciblé réussis. La mise en page réelle des fichiers reste à vérifier visuellement avant réception du lot documents.
- Point restant : l'ordre d'affichage du référentiel n'est pas conservé dans `definition_snapshot` par V86. Sa conservation pour les futurs calculs nécessite une migration; les anciens cycles ne doivent pas être réordonnés selon un référentiel modifié depuis leur calcul.

## Audit RH & Paie et V148 — 25 novembre 2026

- Audit complet, diagnostic, causes, architecture cible et plan P0–P3 : `docs/audit-erp/32-audit-rh-paie.md`.
- V148 corrige trois anomalies P0 démontrées : le salaire était calculé sur l'état du dernier jour du mois (embauche,
  sortie, suspension ou augmentation en cours de mois mal payées, `hire_date` ignorée) ; un net négatif passait le
  précontrôle ; « Ajouter » une rubrique avec un code existant la remplaçait. Prorata par segments de présence, méthode
  par société (`calendar_days` / `thirty_days`), `prorated` par rubrique, photographie du détail de présence.
- Test : `PaieProrataPresenceIT`. Non déployé sur `qerp_reel` ni Supabase.

## V99 et recette complète — 17 novembre 2026

- V99 photographie `sort_order` dans chaque ligne de rubrique issue du référentiel; le bulletin place le salaire de base en premier, trie les nouvelles rubriques sur le rang enregistré, et garde l'ordre reçu pour les cycles antérieurs sans rang.
- La recette PostgreSQL ciblée `HrApiIT.affectationRubriqueSalarieeIsolee` passe; elle modifie le rang après le premier calcul et vérifie que le cycle conserve son rang photographié tandis que le calcul suivant prend le nouveau rang.
- Suite Java complète sous JDK 25.0.5 : Maven `verify`, **207 tests, 0 échec**. Vitest complet réparti à cause de timeouts de démarrage de workers : **575 tests passent dans le passage principal, puis les quatre fichiers qui n'avaient pas démarré passent isolément (15/15)**, soit 590 assertions couvrant 100 fichiers. Les tests RH ciblés passent 25/25.
- TypeScript passe; `npm run api:check` confirme le contrat OpenAPI; `npm run db:check-twins` confirme 83 paires V16–V99 identiques; `npm run build` réussit. ESLint : 0 erreur et 705 avertissements.
- Les timeouts Vitest provenaient de workers qui ne démarraient pas sous forte charge, sans échec d'assertion dans les fichiers concernés; leur exécution isolée a réussi.
- Recette E2E cloud complémentaire : `npm run test:e2e:parcours` donne 33 réussites et 3 échecs dans `71-inventaires-physiques.spec.ts`. Le catalogue des campagnes répond HTTP 404 sur Supabase; l'aperçu et l'analyse ABC ne reçoivent donc pas leur état attendu. Les parcours Budget 94 et les autres parcours connectés exécutés réussissent. Cela confirme que les migrations Stock S3 ne sont pas synchronisées sur le projet Supabase de recette; aucune migration distante n'a été appliquée pendant cette vérification.
