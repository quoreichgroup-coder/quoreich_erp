# Livraison RH et paie — plan d’implémentation

> **Pour les agents d’exécution :** suivre les tâches dans l’ordre et écrire/exécuter le test spécifié avant chaque comportement. Aucune migration ne doit être appliquée à Supabase ou à une base métier avant réussite des tests et contrôle des migrations jumelées.

**Objectif :** livrer les parcours RH/Paie réels, sécurisés et paramétrables, avec parité Supabase/on-premise avant la recette utilisateur.

**Architecture :** conserver les migrations PostgreSQL jumelées, déplacer les mutations et contrôles sensibles dans SQL/API, et faire appeler un adaptateur commun aux écrans afin que `VITE_QERP_API_URL` route vers l’API on-premise et son absence vers Supabase. Livrer chaque flux verticalement de la table au rapport.

**Technologies :** React 19, TypeScript, TanStack Query, Supabase/PostgreSQL, API Java Spring Boot, Flyway, Failsafe/Testcontainers, Vitest.

**Spécification :** `docs/superpowers/specs/2026-11-15-paie-rh-complete-design.md`

## Contraintes globales

- Chaque migration Flyway V81+ a une jumelle Supabase au SQL exécutable identique; le contrôle `npm run db:check-twins` passe.
- Toutes les lectures/écritures sont isolées par société; les droits sont contrôlés côté serveur/RLS/API.
- Aucun taux légal, droit de congé ou format bancaire n’est inventé ou codé en dur.
- Aucune fausse donnée métier n’est ajoutée aux bases Supabase ou `qerp_reel`.
- Une paie comptabilisée n’est jamais modifiée; les corrections conservent l’audit et les cycles historiques.
- Les exports reproduisent les filtres et la population visibles, conservent les devises et masquent les données sensibles hors droit.

## Points de revue

- Un employé appartient à un autre tenant ou la session change de société : chaque requête doit refuser ou ne retourner que le tenant courant.
- Un rôle peut voir le dossier sans voir salaire/IBAN, ou exporter sans droit sensible : les champs ne doivent pas fuir dans les réponses/API, fichiers ou journaux.
- Une mutation effective au futur ou rétroactive chevauche un mouvement approuvé : les règles de date d’effet doivent éviter deux affectations actives ou altérer une paie postée.
- Un calcul utilise un barème absent, non confirmé ou expiré : aucune ligne de paie ne doit être générée.
- Une génération de fichier ou un posting est rejoué : la même dette ou le même paiement ne doit pas être créé deux fois.

---

### Task 1 : Contrat API RH et sécurité des champs sensibles

**Fichiers :**
- Modifier : `src/hooks/use-hr-data.ts`, `src/api/client.ts`
- Créer : `services/api/src/main/java/com/quoreich/qerp/hr/HrController.java`, `HrQuery.java`, DTO RH et tests associés
- Créer : `services/api/src/main/resources/db/migration/V81__securite_et_referentiels_rh.sql` et jumelle `supabase/migrations/<timestamp>_*.sql`
- Tester : `services/api/src/test/java/com/quoreich/qerp/HrApiIT.java`, tests hook RBAC et test d’isolation tenant

**Interfaces :** endpoints versionnés `/api/v1/hr/employees`, `/payroll/settings`, `/payroll/runs`, `/payroll/runs/{id}/lines`, `/payroll/runs/{id}/audit`; réponses identiques aux types front existants. Les mutations SQL gardent l’autorité via `auth.uid()`, tenant actif, `has_hr_perm` et `has_permission`.

- [x] Écrire les tests d’intégration pour lecture salarié avec droit, refus sans droit, champ salaire/IBAN absent hors `hr.view_sensitive`, run cross-tenant inaccessible, et vérification de l’état de routes.
- [x] Exécuter `EtatsParRubriquesIT`, nouveaux `HrApiIT` et test de migration; vérifier les refus attendus avant implémentation.
- [x] Ajouter un adaptateur RH API/Supabase dans les hooks avec clé de cache incluant tenant et source; appliquer une projection serveur qui retire les colonnes sensibles sans droit.
- [x] Ajouter les endpoints Java pour lectures et opérations de cycle déjà prises en charge par les RPC; ne pas dupliquer leur calcul ou leur contrôle SQL.
- [x] Rejouer les tests API ciblés et les tests hooks, puis vérifier les rôles centraux et la parité des migrations.

### Task 2 : Mouvements effectifs-datés et audit RH

**Fichiers :**
- Modifier : `src/pages/Employees.tsx`, `src/hooks/use-hr-data.ts`, `src/lib/hr-roles.ts`, `src/pages/HrSettings.tsx`
- Créer : migration paire `employee_movement` / référentiels de motifs, composants et tests RH
- Tester : `EmployeeMovementsIT`, tests UI mouvements et restrictions de rôle

**Interfaces :** créer/approuver un mouvement par RPC/API avec salarié, type, date d’effet, motif, valeurs avant/après et commentaire; historique renvoie événements chronologiques et solde/dossier à la date sélectionnée.

- [ ] Écrire tests d’embauche, changement futur, changement de salaire/département, départ, réintégration, motif requis, chevauchement interdit, tenant séparé et SoD.
- [x] Implémenter migrations, RLS, audit immuable et fonctions transactionnelles de soumission/approbation/application.
- [x] Remplacer la modification silencieuse des champs emploi dans l’annuaire par un dialogue de mouvement; garder les données identitaires séparées des mutations d’emploi.
- [x] Ajouter sous Paramètres RH les types et motifs configurables, sans valeurs légales implicites.
- [ ] Vérifier les parcours Supabase/on-premise et que les cycles existants gardent leurs photographies.

### Task 3 : Définitions de paie, variables et photographie des composantes

**Fichiers :**
- Modifier : `src/components/PayrollSettingsCard.tsx`, `src/pages/HrSettings.tsx`, `src/components/PayrollRunDialog.tsx`, `src/lib/payroll-engine.ts`, `src/hooks/use-hr-data.ts`
- Créer : migrations jumelles pour types d’éléments, règles de calcul, affectations employés, saisies variables et lignes détaillées
- Tester : `PayrollComponentsIT`, `PayrollVariablesIT`, tests unitaires d’arrondi, périodes et règles d’effet

**Interfaces :** définitions versionnées par société/pays (code, libellé, gain/retenue/charge, méthode, plafond, dates, compte rôle, imprimable); lignes calculées conservant base/taux/montant/source et photographie de la définition.

- [ ] Écrire tests des gains fixes/variables et retenues configurés, dates d’effet, plafonds configurés, élément désactivé, double saisie, arrondis et devise.
- [x] Ajouter le catalogue tenant des gains/retenues/charges et son écran Paramètres V84, protégé par le catalogue central `hr.manage_payroll_components`.
- [ ] Corriger la validation des tranches de V80 par une nouvelle migration, dont la borne finale non limitée, et tester les bandes manquantes/invalides.
- [ ] Ajouter configuration, affectations et saisie/approuvabilité des variables avec traçabilité de source.
- [ ] Calculer les lignes détaillées côté serveur et photographier paramètres, mouvements, variables, salarié et compte de chaque cycle.
- [ ] Exécuter la suite Java RH et Vitest ciblées avant la suite complète.

### Task 4 : Précontrôle, approbation, comptabilisation et correction

**Fichiers :**
- Modifier : `src/components/PayrollRunDialog.tsx`, `src/pages/HrControl.tsx`, migrations SQL/API des cycles
- Créer : écran d’exceptions/précontrôle et tests de cycle

**Interfaces :** RPC/API précontrôle retourne erreurs/avertissements persistés; approuver exige zéro erreur bloquante et SoD; correction après posting passe par ajustement/contrepassation lié au cycle initial.

- [ ] Tester totaux débiteurs/créditeurs équilibrés, comptes manquants, cycle vide, double posting, modification après approbation, correction et rejet de séparation des fonctions.
- [ ] Persister résultats de contrôle et séquences génération/approbation/posting avec auteur et date.
- [ ] Implémenter transitions verrouillées et contrepassation/ajustement idempotent.
- [ ] Vérifier par test la piste d’audit, la ligne comptable et le statut après chaque transition.

### Task 5 : Bulletins individuels et rapports de réconciliation

**Fichiers :**
- Modifier : `src/pages/HrReporting.tsx`, `src/components/PayrollExportPreviewDialog.tsx`, `src/lib/payroll-recap-pdf.ts`, `src/lib/pdf-export.ts`, `src/lib/xlsx.ts`
- Créer : route/aperçu bulletin, endpoints/RPC sécurisés et tests PDF/XLSX/CSV

**Interfaces :** bulletin individuel par cycle/salarié assemblé à partir des composants persistés; accès nominatif serveur; réédition consignée; rapport agrège MTD/YTD et compare périodes par devise sans conversion implicite.

- [ ] Tester accès individuel, montants masqués, filtres population, et absence de fuite sensible dans texte, CSV, feuilles cachées, PDF et impression.
- [ ] Ajouter bulletin PDF avec identité société/salarié, période, composantes, totaux, devise et référence du cycle.
- [ ] Ajouter rapport pré/post paie, composants, MTD/YTD et département/axe analytique avec colonnes et filtres cohérents écran/export.
- [ ] Vérifier visuellement PDF et XLSX réels avec aperçu et rendu A4; contrôler CSV UTF-8 et format configuré.

### Task 6 : Paiements, profils de banque et retours

**Fichiers :**
- Modifier : navigation RH, `src/pages/HrTransactions.tsx`, `src/pages/HrSettings.tsx`, `src/hooks/use-hr-data.ts`
- Créer : migrations pour lots/paiements/profils versionnés/retours, contrôleurs Java, pages de paiement et tests

**Interfaces :** lot créé depuis cycle posté; validation des bénéficiaires et totaux par devise; fichier rendu uniquement avec profil banque configuré et validé; retours importés idempotemment par identifiant de banque.

- [ ] Tester lot partiel, rejet, correction, doublon, devise, profil manquant, SoD, IBAN masqué et rapprochement incomplet.
- [ ] Ajouter paramétrage du format bancaire à champs/longueurs/séquence versionnés; aucun profil prêt-à-l’emploi sans spécimen.
- [ ] Ajouter prévisualisation/rapport, export protégé, empreinte du fichier et statuts préparé, approuvé, émis, accepté, rejeté, payé, rapproché.
- [ ] Lier le paiement et son écriture au cycle/la dette sans double comptabiliser.

### Task 7 : Temps, absences, approbations et éléments variables

**Fichiers :**
- Modifier : navigation et référentiels RH
- Créer : migrations jumelles, adaptateurs API/Supabase, pages, règles métier et tests

- [ ] Définir calendrier, compteurs, catégories et politiques paramétrables par société/pays; ne pas fournir de politique légale non sourcée.
- [ ] Tester chevauchement, solde insuffisant, approbation/délégation, annulation et incidence sur une période de paie.
- [ ] Faire transiter les éléments approuvés par le contrat de variables de la Tâche 3 et les figer au calcul.
- [ ] Produire états de soldes et de mouvements avec droits/audit.

### Task 8 : Réception intégrée et documentation de lot

**Fichiers :**
- Mettre à jour : `docs/recette-paie-v80.md`, `docs/roadmap-paie-rh.md`, documentation des paramètres et rapports
- Tester : suites Java, Vitest, TypeScript, lint ciblé, build web et parcours E2E cloud/on-premise RH

- [ ] Exécuter des parcours complets sur une société de test dédiée: embauche → mouvement → variables → calcul/précontrôle → approbation → posting → bulletin → paiement/retour → reporting.
- [ ] Jouer les parcours à la fois avec `VITE_QERP_API_URL` et avec Supabase; prouver qu’une écriture on-premise n’apparaît pas dans Supabase.
- [ ] Vérifier menus, Paramètres, rôles centralisés, sécurité des champs, exports, impression, erreurs réseau et absence de valeurs de démo.
- [ ] Exécuter `mvnw verify`, `npm test`, `tsc`, lint ciblé, build web et `npm run db:check-twins`; consigner chaque résultat et les réserves externes.
